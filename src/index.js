import DOCS from './help.html';

addEventListener("fetch", (event) => {
  event.passThroughOnException();
  event.respondWith(handleRequest(event.request));
});

// Read bindings from the runtime (Cloudflare vars/secrets) with safe fallbacks for build time
function getBinding(key, fallback) {
  if (typeof process !== "undefined" && process.env && process.env[key]) {
    return process.env[key];
  }
  if (typeof globalThis !== "undefined" && typeof globalThis[key] !== "undefined") {
    return globalThis[key];
  }
  return fallback;
}

const CUSTOM_DOMAIN = getBinding("CUSTOM_DOMAIN", "saymi-labs.top");
const MODE = getBinding("MODE", "production");
const TARGET_UPSTREAM = getBinding("TARGET_UPSTREAM", "");

const dockerHub = "https://registry-1.docker.io";

const routes = {
  // production
  ["docker." + CUSTOM_DOMAIN]: dockerHub,
  ["quay." + CUSTOM_DOMAIN]: "https://quay.io",
  ["gcr." + CUSTOM_DOMAIN]: "https://gcr.io",
  ["k8s-gcr." + CUSTOM_DOMAIN]: "https://k8s.gcr.io",
  ["k8s." + CUSTOM_DOMAIN]: "https://registry.k8s.io",
  ["ghcr." + CUSTOM_DOMAIN]: "https://ghcr.io",
  ["cloudsmith." + CUSTOM_DOMAIN]: "https://docker.cloudsmith.io",
  ["ecr." + CUSTOM_DOMAIN]: "https://public.ecr.aws",

  // staging
  ["docker-staging." + CUSTOM_DOMAIN]: dockerHub,
};

function routeByHosts(host) {
  if (host in routes) {
    return routes[host];
  }
  if (MODE == "debug") {
    return TARGET_UPSTREAM;
  }
  return "";
}

async function handleRequest(request) {
  const url = new URL(request.url);
  // if (url.pathname == "/") {
  //   return Response.redirect(url.protocol + "//" + url.host + "/v2/", 301);
  // }
  // return docs
  if (url.pathname === "/") {
    const html = DOCS.replace(/\{\{host\}\}/g, CUSTOM_DOMAIN);
    return new Response(html, {
      status: 200,
      headers: {
        "content-type": "text/html"
      }
    });
  }
  const upstream = routeByHosts(url.hostname);
  if (upstream === "") {
    return new Response(
      JSON.stringify({
        routes: routes,
      }),
      {
        status: 404,
      }
    );
  }
  const isDockerHub = upstream == dockerHub;
  const authorization = request.headers.get("Authorization");
  // block _catalog endpoint for Docker Hub to avoid misleading 401 responses
  if (url.pathname === "/v2/_catalog" && isDockerHub) {
    return new Response(
      JSON.stringify({
        errors: [{
          code: "UNSUPPORTED",
          message: "The catalog API is not supported by Docker Hub",
          detail: "Docker Hub has disabled the /v2/_catalog endpoint due to performance considerations. Please use specific image names instead."
        }]
      }),
      {
        status: 404,
        headers: {
          "Content-Type": "application/json"
        }
      }
    );
  }
  if (url.pathname == "/v2/") {
    const newUrl = new URL(upstream + "/v2/");
    const headers = new Headers();
    if (authorization) {
      headers.set("Authorization", authorization);
    }
    // check if need to authenticate
    const resp = await fetch(newUrl.toString(), {
      method: "GET",
      headers: headers,
      redirect: "follow",
    });
    if (resp.status === 401) {
      return responseUnauthorized(url);
    }
    return resp;
  }
  // get token
  if (url.pathname == "/v2/auth") {
    const newUrl = new URL(upstream + "/v2/");
    const resp = await fetch(newUrl.toString(), {
      method: "GET",
      redirect: "follow",
    });
    if (resp.status !== 401) {
      return resp;
    }
    const authenticateStr = resp.headers.get("WWW-Authenticate");
    if (authenticateStr === null) {
      return resp;
    }
    const wwwAuthenticate = parseAuthenticate(authenticateStr);
    let scope = url.searchParams.get("scope");
    // autocomplete repo part into scope for DockerHub library images
    // Example: repository:busybox:pull => repository:library/busybox:pull
    if (scope && isDockerHub) {
      let scopeParts = scope.split(":");
      if (scopeParts.length == 3 && !scopeParts[1].includes("/")) {
        scopeParts[1] = "library/" + scopeParts[1];
        scope = scopeParts.join(":");
      }
    }
    return await fetchToken(wwwAuthenticate, scope, authorization);
  }
  // redirect for DockerHub library images
  // Example: /v2/busybox/manifests/latest => /v2/library/busybox/manifests/latest
  if (isDockerHub) {
    const pathParts = url.pathname.split("/");
    if (pathParts.length == 5) {
      pathParts.splice(2, 0, "library");
      const redirectUrl = new URL(url);
      redirectUrl.pathname = pathParts.join("/");
      return Response.redirect(redirectUrl, 301);
    }
  }
  // foward requests
  const newUrl = new URL(upstream + url.pathname);
  const newReq = new Request(newUrl, {
    method: request.method,
    headers: request.headers,
    // don't follow redirect to dockerhub blob upstream
    redirect: isDockerHub ? "manual" : "follow",
  });
  const resp = await fetch(newReq);
  if (resp.status == 401) {
    return responseUnauthorized(url);
  }
  // handle dockerhub blob redirect manually
  if (isDockerHub && resp.status == 307) {
    const location = new URL(resp.headers.get("Location"));
    const redirectResp = await fetch(location.toString(), {
      method: "GET",
      redirect: "follow",
    });
    return redirectResp;
  }
  return resp;
}

function parseAuthenticate(authenticateStr) {
  // sample: Bearer realm="https://auth.ipv6.docker.com/token",service="registry.docker.io"
  // match strings after =" and before "
  const re = /(?<=\=")(?:\\.|[^"\\])*(?=")/g;
  const matches = authenticateStr.match(re);
  if (matches == null || matches.length < 2) {
    throw new Error(`invalid Www-Authenticate Header: ${authenticateStr}`);
  }
  return {
    realm: matches[0],
    service: matches[1],
  };
}

async function fetchToken(wwwAuthenticate, scope, authorization) {
  const url = new URL(wwwAuthenticate.realm);
  if (wwwAuthenticate.service.length) {
    url.searchParams.set("service", wwwAuthenticate.service);
  }
  if (scope) {
    url.searchParams.set("scope", scope);
  }
  const headers = new Headers();
  if (authorization) {
    headers.set("Authorization", authorization);
  }
  return await fetch(url, { method: "GET", headers: headers });
}

function responseUnauthorized(url) {
  const headers = new Headers();
  if (MODE == "debug") {
    headers.set(
      "Www-Authenticate",
      `Bearer realm="http://${url.host}/v2/auth",service="cloudflare-docker-proxy"`
    );
  } else {
    headers.set(
      "Www-Authenticate",
      `Bearer realm="https://${url.hostname}/v2/auth",service="cloudflare-docker-proxy"`
    );
  }
  return new Response(JSON.stringify({ message: "UNAUTHORIZED" }), {
    status: 401,
    headers: headers,
  });
}
