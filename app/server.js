'use strict';

// Northline site console. Live panels read the cluster the pod runs on.
// Radio rows are simulated and the API says so: there is no user plane here.

const http  = require('http');
const https = require('https');
const fs    = require('fs');
const os    = require('os');

const PORT = parseInt(process.env.PORT || '3000', 10);

// Projected service account tokens rotate, so read them on every call.
const TOKEN_PATH = '/var/run/secrets/kubernetes.io/serviceaccount/token';
const CA_PATH    = '/var/run/secrets/kubernetes.io/serviceaccount/ca.crt';
const K8S_HOST   = process.env.KUBERNETES_SERVICE_HOST;
const K8S_PORT   = process.env.KUBERNETES_SERVICE_PORT || '443';

function k8sGet(path) {
  return new Promise((resolve, reject) => {
    if (!K8S_HOST) return reject(new Error('not running in a cluster'));
    let token, ca;
    try {
      token = fs.readFileSync(TOKEN_PATH, 'utf8').trim();
      ca    = fs.readFileSync(CA_PATH);
    } catch (e) {
      return reject(new Error(`service account: ${e.message}`));
    }
    const req = https.request({
      hostname: K8S_HOST, port: K8S_PORT, path, method: 'GET',
      headers: { Authorization: `Bearer ${token}` }, ca, timeout: 5000,
    }, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        if (res.statusCode >= 400) {
          const err = new Error(`${path}: HTTP ${res.statusCode}`);
          err.status = res.statusCode;
          return reject(err);
        }
        try { resolve(JSON.parse(body)); }
        catch { reject(new Error(`${path}: not JSON`)); }
      });
    });
    req.on('timeout', () => req.destroy(new Error(`${path}: timed out`)));
    req.on('error', reject);
    req.end();
  });
}

function distribution(v) {
  if (!v) return 'Kubernetes';
  if (v.includes('+rke2')) return 'RKE2';
  if (v.includes('+k3s'))  return 'K3s';
  return 'Kubernetes';
}

function roles(labels = {}) {
  const r = Object.keys(labels)
    .filter(k => k.startsWith('node-role.kubernetes.io/'))
    .map(k => k.split('/')[1]);
  return r.length ? r.sort().join(', ') : 'worker';
}

// Simulated radio layer. Stable per site name so a refresh does not reshuffle.
function simulatedSectors(site) {
  let seed = [...site].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const rnd = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32;
  const drift = Math.sin(Date.now() / 60_000);
  return ['A', 'B', 'C'].map(s => {
    const prb = Math.round(35 + rnd() * 40 + drift * 5);
    return {
      sector: `${site}-${s}`,
      band: ['n78', 'n28', 'n1'][Math.floor(rnd() * 3)],
      prbUtilisation: prb,
      attachedUEs: Math.round(80 + rnd() * 400),
      status: prb > 80 ? 'congested' : 'ok',
    };
  });
}

let cache = null, cacheTime = 0;

async function siteInfo() {
  if (cache && Date.now() - cacheTime < 15_000) return cache;

  const site = process.env.CLUSTER_NAME || 'northline-site';
  const live = {
    site,
    siteType: process.env.SITE_TYPE || 'downstream',
    node: process.env.NODE_NAME || os.hostname(),
    pod: process.env.POD_NAME || os.hostname(),
    namespace: process.env.POD_NAMESPACE || 'default',
    hostIP: process.env.HOST_IP || 'unknown',
    kubernetes: 'unknown',
    distribution: 'unknown',
    osImage: 'unknown',
    nodeRoles: 'unknown',
    nodeCount: null,
    podsRunning: null,
    podsTotal: null,
    virtualMachines: null,   // null: KubeVirt not installed on this site
    errors: [],
  };

  const [ver, nodes, pods, vmis] = await Promise.allSettled([
    k8sGet('/version'),
    k8sGet('/api/v1/nodes'),
    k8sGet('/api/v1/pods'),
    k8sGet('/apis/kubevirt.io/v1/virtualmachineinstances'),
  ]);

  if (ver.status === 'fulfilled') {
    live.kubernetes = ver.value.gitVersion;
    live.distribution = distribution(ver.value.gitVersion);
  } else live.errors.push(ver.reason.message);

  if (nodes.status === 'fulfilled') {
    const items = nodes.value.items || [];
    live.nodeCount = items.length;
    const me = items.find(n => n.metadata.name === live.node) || items[0];
    if (me) {
      live.osImage = me.status?.nodeInfo?.osImage || live.osImage;
      live.nodeRoles = roles(me.metadata.labels);
    }
  } else live.errors.push(nodes.reason.message);

  if (pods.status === 'fulfilled') {
    const items = pods.value.items || [];
    live.podsTotal = items.length;
    live.podsRunning = items.filter(p => p.status?.phase === 'Running').length;
  } else live.errors.push(pods.reason.message);

  if (vmis.status === 'fulfilled') {
    live.virtualMachines = (vmis.value.items || []).map(v => ({
      name: v.metadata.name,
      namespace: v.metadata.namespace,
      phase: v.status?.phase || 'Unknown',
      node: v.status?.nodeName || '',
    }));
  } else if (vmis.reason.status !== 404) live.errors.push(vmis.reason.message);

  cache = {
    live,
    simulated: { note: 'Simulated radio data. No user plane runs on this site.',
                 sectors: simulatedSectors(site) },
    timestamp: new Date().toISOString(),
  };
  cacheTime = Date.now();
  return cache;
}

const INDEX = fs.readFileSync(`${__dirname}/index.html`, 'utf8');

http.createServer(async (req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('OK');
  }
  if (req.url === '/api/site') {
    try {
      const body = JSON.stringify(await siteInfo());
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
      return res.end(body);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: e.message }));
    }
  }
  if (req.url === '/' || req.url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(INDEX);
  }
  res.writeHead(404);
  res.end('Not found');
}).listen(PORT, '0.0.0.0', () => {
  console.log(`[site-console] ${process.env.CLUSTER_NAME || 'northline-site'} on :${PORT}, ` +
              (K8S_HOST ? `in-cluster ${K8S_HOST}:${K8S_PORT}` : 'standalone'));
});
