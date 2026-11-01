/**
 * Copyright 2018 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *     http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// If the loader is already loaded, just stop.
if (!self.define) {
  let registry = {};

  // Used for `eval` and `importScripts` where we can't get script URL by other means.
  // In both cases, it's safe to use a global var because those functions are synchronous.
  let nextDefineUri;

  const singleRequire = (uri, parentUri) => {
    uri = new URL(uri + ".js", parentUri).href;
    return registry[uri] || (
      
        new Promise(resolve => {
          if ("document" in self) {
            const script = document.createElement("script");
            script.src = uri;
            script.onload = resolve;
            document.head.appendChild(script);
          } else {
            nextDefineUri = uri;
            importScripts(uri);
            resolve();
          }
        })
      
      .then(() => {
        let promise = registry[uri];
        if (!promise) {
          throw new Error(`Module ${uri} didn’t register its module`);
        }
        return promise;
      })
    );
  };

  self.define = (depsNames, factory) => {
    const uri = nextDefineUri || ("document" in self ? document.currentScript.src : "") || location.href;
    if (registry[uri]) {
      // Module is already loading or loaded.
      return;
    }
    let exports = {};
    const require = depUri => singleRequire(depUri, uri);
    const specialDeps = {
      module: { uri },
      exports,
      require
    };
    registry[uri] = Promise.all(depsNames.map(
      depName => specialDeps[depName] || require(depName)
    )).then(deps => {
      factory(...deps);
      return exports;
    });
  };
}
define(['./workbox-7b16fee0'], (function (workbox) { 'use strict';

  self.addEventListener('message', event => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
      self.skipWaiting();
    }
  });

  /**
   * The precacheAndRoute() method efficiently caches and responds to
   * requests for URLs in the manifest.
   * See https://goo.gl/S9QRab
   */
  workbox.precacheAndRoute([{
    "url": "pwa-maskable-512x512.png",
    "revision": "e8bb610673cabd53ec9aa0b7308e4bb4"
  }, {
    "url": "pwa-512x512.png",
    "revision": "28793d2d6a4034756ccb1278fdaf7711"
  }, {
    "url": "pwa-192x192.png",
    "revision": "3ad0085f6a6a038ffaaa0995282549ed"
  }, {
    "url": "index.html",
    "revision": "84a1de390c0ac25fb7f72778565e4f72"
  }, {
    "url": "icon.svg",
    "revision": "2cd63bce99cb0fe4c675ba60b0246e56"
  }, {
    "url": "favicon.ico",
    "revision": "9cbde2731207bbb65076fd258f84f7b8"
  }, {
    "url": "apple-touch-icon.png",
    "revision": "c8eba170adc8bca3f2e663644bbb6055"
  }, {
    "url": "assets/index-DQVVqaUC.css",
    "revision": null
  }, {
    "url": "assets/index-CE0sY358.js",
    "revision": null
  }, {
    "url": "assets/aistudio/interactive_visual_im_b85db2ad2477683d_287a157b.html",
    "revision": null
  }, {
    "url": "apple-touch-icon.png",
    "revision": "c8eba170adc8bca3f2e663644bbb6055"
  }, {
    "url": "favicon.ico",
    "revision": "9cbde2731207bbb65076fd258f84f7b8"
  }, {
    "url": "icon.svg",
    "revision": "2cd63bce99cb0fe4c675ba60b0246e56"
  }, {
    "url": "pwa-192x192.png",
    "revision": "3ad0085f6a6a038ffaaa0995282549ed"
  }, {
    "url": "pwa-512x512.png",
    "revision": "28793d2d6a4034756ccb1278fdaf7711"
  }, {
    "url": "pwa-maskable-512x512.png",
    "revision": "e8bb610673cabd53ec9aa0b7308e4bb4"
  }, {
    "url": "manifest.webmanifest",
    "revision": "0242715537500f7e81696f0c9a0da087"
  }], {});
  workbox.cleanupOutdatedCaches();
  workbox.registerRoute(new workbox.NavigationRoute(workbox.createHandlerBoundToURL("index.html")));
  workbox.registerRoute(/^https:\/\/fonts\.googleapis\.com\/.*/i, new workbox.CacheFirst({
    "cacheName": "google-fonts-cache",
    plugins: [new workbox.ExpirationPlugin({
      maxEntries: 10,
      maxAgeSeconds: 31536000
    }), new workbox.CacheableResponsePlugin({
      statuses: [0, 200]
    })]
  }), 'GET');
  workbox.registerRoute(/^https:\/\/fonts\.gstatic\.com\/.*/i, new workbox.CacheFirst({
    "cacheName": "gstatic-fonts-cache",
    plugins: [new workbox.ExpirationPlugin({
      maxEntries: 10,
      maxAgeSeconds: 31536000
    }), new workbox.CacheableResponsePlugin({
      statuses: [0, 200]
    })]
  }), 'GET');

}));
