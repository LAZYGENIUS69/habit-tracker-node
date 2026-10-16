# Running Habit Tracker on Kubernetes (Minikube)

The same Habit Tracker application you ran with `docker compose`, now running on a local Kubernetes cluster using Minikube. Compare the two architectures side-by-side to understand how Kubernetes abstracts infrastructure, enforces declarative desired state, and provides automated recovery.

| Docker Compose | Kubernetes | Architectural Distinction |
|---|---|---|
| `services: app:` | Deployment (`04-deployment.yml`) | Compose keeps 1 container running; a Deployment maintains $N$ replica Pods and reschedules them on node/pod failure. |
| `ports: "8080:8080"` | Service (`05-service.yml`) | Compose binds directly to the host network interface. Kubernetes Services provide a stable internal cluster IP and DNS name across ephemeral Pod IPs. |
| `depends_on: condition: service_healthy` | `readinessProbe` + InitContainer | Kubernetes has no declarative `depends_on` between Pods. A Pod is simply kept out of the Service endpoint pool until its readiness probe succeeds. |
| `migrate:` one-shot container | Job (`03-migrate-job.yml`) | Compose runs an ephemeral container. Kubernetes manages batch execution via a dedicated `Job` controller with completion and retry tracking. |
| Named volume `pgdata` | `PersistentVolumeClaim` (`01-db.yml`) | Compose manages a local Docker host directory. Kubernetes decouples storage requests (`PVC`) from underlying physical disk allocation (`PV` / StorageClass). |

---

## 1. Prerequisites & Cluster Startup

Ensure Docker Desktop is running and Minikube is started:

```powershell
# Check current Minikube status
minikube status

# Start Minikube with the Docker driver (if stopped)
minikube start --driver=docker
```

Verify your Kubernetes CLI context points to Minikube:

```powershell
kubectl cluster-info
kubectl get nodes -o wide
```

---

## 2. One-Time Setup: Building & Loading Images

Because local Minikube clusters cannot pull unpublished local tags from public registries, load all required container images from your local Docker engine directly into the Minikube virtual environment:

```powershell
# 1. Build the local application image
docker build -t habit-tracker:local .

# 2. Load images into the Minikube control-plane cache
minikube image load habit-tracker:local
minikube image load postgres:16.15-alpine
minikube image load redis:7.4.11-alpine
minikube image load curlimages/curl:8.10.1

# 3. Verify all required images exist inside Minikube
minikube image ls | Select-String "habit-tracker|postgres|redis|curlimages"
```

> **Why `imagePullPolicy: IfNotPresent`?**  
> Every manifest sets `imagePullPolicy: IfNotPresent`. This instructs Kubernetes to use the locally loaded image in Minikube's cache rather than attempting to download it from Docker Hub, which would result in an `ErrImagePull` / `ImagePullBackOff` failure.

### Transitioning to a Production Docker Hub Image
Once a release image is formally pushed to Docker Hub via CI (e.g., `youruser/habit-tracker-node:1.0.0`):
1. In `04-deployment.yml` (and `03-migrate-job.yml`), update `image:` to `youruser/habit-tracker-node:1.0.0`.
2. Change `imagePullPolicy:` to `Always` (or `IfNotPresent` for immutable SemVer tags).
3. If the registry is private, create an `imagePullSecrets` Secret:
   ```powershell
   kubectl create secret docker-registry regcred `
     --docker-server=https://index.docker.io/v1/ `
     --docker-username="<DOCKERHUB_USER>" `
     --docker-password="<DOCKERHUB_TOKEN>" `
     --dry-run=client -o yaml | kubectl apply -f -
   ```

---

## 3. Creating the Database Secret

Kubernetes Secrets decouple sensitive credentials from application code and ConfigMaps. Create the database password Secret:

```powershell
# Idempotent Secret creation using client-side dry-run
kubectl create secret generic habit-tracker-secret `
  --from-literal=POSTGRES_PASSWORD=habits `
  --dry-run=client -o yaml | kubectl apply -f -
```

> [!WARNING]
> **Production Secrets Limitation**: Kubernetes Secrets are stored in etcd as base64-encoded strings, not encrypted ciphertext by default. In enterprise production environments, use external secret managers (HashiCorp Vault, AWS Secrets Manager, or External Secrets Operator) with envelope encryption via KMS.

---

## 4. Applying Manifests in Deployment Order

Manifests must be applied in a strict dependency sequence:
**Config & Storage → PostgreSQL & Redis → Database Migration Job → Application Deployment & Service**.

```powershell
# Step 1: Apply non-sensitive configuration
kubectl apply -f kube/00-config.yml

# Step 2: Provision database (PVC, Deployment, Service) and cache
kubectl apply -f kube/01-db.yml
kubectl apply -f kube/02-cache.yml

# Step 3: Wait for database and cache Pods to reach Ready status
kubectl rollout status deployment/db
kubectl rollout status deployment/cache

# Step 4: Execute database schema migrations
kubectl apply -f kube/03-migrate-job.yml

# Step 5: Wait for migration Job completion
kubectl wait --for=condition=complete job/habit-tracker-migrate --timeout=60s

# Step 6: Deploy the Habit Tracker application and Service
kubectl apply -f kube/04-deployment.yml
kubectl apply -f kube/05-service.yml

# Step 7: Wait for application rollout
kubectl rollout status deployment/habit-tracker
```

---

## 5. Verifying Deployment & Probes

Inspect all cluster objects to verify healthy status:

```powershell
kubectl get pods,services,endpoints,pvc,jobs -o wide
```

Expected states:
- **`postgres-pvc`**: `STATUS: Bound` (attached to Minikube hostpath storage provisioner).
- **`habit-tracker-migrate`**: `COMPLETIONS: 1/1`.
- **`habit-tracker` Pods**: `READY: 1/1` and `STATUS: Running`.
- **`habit-tracker` Endpoints**: Shows active container IPs on port 8080.

### Readiness vs Liveness Probes
- **Readiness Probe (`/health`)**: Queries both PostgreSQL and Redis. If either service is down or degraded, `/health` returns HTTP 503, temporarily removing the Pod from the Service endpoint pool so traffic is never routed to an unready replica.
- **Liveness Probe (`/`)**: Evaluates basic process responsiveness without probing downstream databases. This prevents cascading restart loops if PostgreSQL or Redis undergoes a brief transient hiccup.

---

## 6. Accessing the Application

Because Minikube on Windows runs inside a virtualized Docker Desktop network, NodePort services are not directly routeable from the Windows host browser. Use `kubectl port-forward`:

```powershell
# Forward local port 8090 to the habit-tracker Service on 8080
kubectl port-forward svc/habit-tracker 8090:8080
```

In a separate terminal or web browser, verify the application:

```powershell
# 1. Health check (must report postgres: true, redis: true)
curl.exe -i http://localhost:8090/health

# 2. Retrieve initial habit list seeded by migrations
curl.exe -s http://localhost:8090/habits | ConvertFrom-Json | Select-Object -ExpandProperty habits
```

Expected `/health` JSON:
```json
{"status":"ok","postgres":true,"redis":true}
```

---

## 7. In-Cluster Connectivity & DNS Verification

Launch the test pod to prove that internal cluster DNS and Service discovery function across containers:

```powershell
# Create test pod
kubectl apply -f kube/pod-test.yaml
kubectl wait --for=condition=ready pod/pod-test --timeout=30s

# Query the application Service through internal cluster DNS
kubectl exec pod-test -- curl -s http://habit-tracker:8080/health
kubectl exec pod-test -- curl -s http://habit-tracker:8080/habits
```

---

## 8. Demonstrations

### Demo A: Deployment Self-Healing vs Bare Pod
Kubernetes Deployments continuously reconcile actual state with desired state (`replicas: 2`). A bare Pod has no controller.

```powershell
# 1. Check current replicas
kubectl get pods -l app=habit-tracker

# 2. Delete one active application Pod
$podToDelete = (kubectl get pods -l app=habit-tracker -o jsonpath="{.items[0].metadata.name}")
kubectl delete pod $podToDelete

# 3. Observe the Deployment controller instantly rescheduling a replacement
kubectl get pods -l app=habit-tracker
```
*Contrast*: Apply `kube/pod.yml` (`kubectl apply -f kube/pod.yml`). Delete `habit-tracker-bare` (`kubectl delete pod habit-tracker-bare`). Because no controller owns it, it is gone forever.

### Demo B: Service Selector Mismatch Debugging
Services route traffic to Pods matching their `spec.selector`. A selector mismatch is the classic silent failure: Pods are Running, but the Service has zero endpoints.

```powershell
# 1. Observe healthy endpoints
kubectl get endpoints habit-tracker

# 2. Patch selector to an invalid label
kubectl patch service habit-tracker -p '{"spec":{"selector":{"app":"invalid-selector"}}}'

# 3. Observe endpoints become <none>
kubectl get endpoints habit-tracker

# 4. Attempting to query the service fails or times out
kubectl exec pod-test -- curl -m 3 http://habit-tracker:8080/health

# 5. Restore correct selector
kubectl patch service habit-tracker -p '{"spec":{"selector":{"app":"habit-tracker"}}}'

# 6. Verify endpoints immediately recover
kubectl get endpoints habit-tracker
```

### Demo C: Migration Idempotency
Rerun the migration process to demonstrate that already applied migrations skip cleanly:

```powershell
# Delete the completed migration job
kubectl delete job habit-tracker-migrate

# Reapply the migration job
kubectl apply -f kube/03-migrate-job.yml
kubectl wait --for=condition=complete job/habit-tracker-migrate --timeout=60s

# Inspect logs: shows all migrations skipped cleanly
kubectl logs -l app=habit-tracker-migrate -c migrate
```

---

## 9. Teardown & Clean Up

Delete all Kubernetes resources without touching your Docker Compose stack or local files:

```powershell
kubectl delete -f kube/05-service.yml
kubectl delete -f kube/04-deployment.yml
kubectl delete -f kube/03-migrate-job.yml
kubectl delete -f kube/02-cache.yml
kubectl delete -f kube/01-db.yml
kubectl delete -f kube/00-config.yml
kubectl delete secret habit-tracker-secret
kubectl delete pod pod-test --ignore-not-found
kubectl delete pod habit-tracker-bare --ignore-not-found
```
