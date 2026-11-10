# telco-site-console

The operations console that Fleet delivers to every Northline site in lab 06 of the [SUSE Telco Cloud workshop](https://github.com/avaleror/suse-telco-workshop).

Northline is a fictional regional mobile operator. The console is the CNF-side workload in the story. It is still only a web page: no user plane, no SR-IOV, no Multus.

## What it shows

| Panel | Source |
|-------|--------|
| Site cluster | Live: Kubernetes version, distribution, node and pod counts |
| This node | Live: node name, roles, OS image, host IP |
| Virtual machines | Live: KubeVirt guests, or "not installed". `site-co-01` shows `site-co-guest` after lab 07 |
| Radio sectors | Simulated, and labelled simulated in the page and the API |

The site name in the header comes from the Rancher cluster display name. Rancher puts it on every Fleet cluster as the label `management.cattle.io/cluster-display-name`, and `fleet.yaml` passes it to the chart. One GitRepo, a different name on each site.

## Layout

```
fleet.yaml        Fleet bundle: namespace, chart, per-cluster values
chart/            Helm chart: ServiceAccount, read-only RBAC, Deployment, NodePort 30080
app/              Node.js server and the page, no dependencies
Dockerfile        SUSE BCI Node.js 20 image
```

## Deploy with Fleet

The workshop applies this GitRepo on the management cluster (`manifests/site-console-gitrepo.yaml` in the workshop repo):

```yaml
apiVersion: fleet.cattle.io/v1alpha1
kind: GitRepo
metadata:
  name: telco-site-console
  namespace: fleet-default
spec:
  repo: https://github.com/avaleror/telco-site-console.git
  branch: main
  targets:
    - clusterSelector:
        matchLabels:
          demo: "true"
          site-type: downstream
```

Open `http://<site-host>:30080`.

## Build the image

```bash
podman build --platform linux/amd64,linux/arm64 \
  --manifest docker.io/avaleror/telco-site-console:latest .
podman manifest push docker.io/avaleror/telco-site-console:latest
```

Run it outside a cluster to work on the page. Live panels show `unknown`, the simulated rows still render:

```bash
PORT=3000 node app/server.js
```

## License

Apache 2.0. See [LICENSE](LICENSE).
