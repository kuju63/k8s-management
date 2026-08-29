import { type App, Chart } from "cdk8s";
import { createHelmApplicationSet } from "../../lib/argocd-applicationset.js";
import { createAppProject } from "../../lib/argocd-project.js";
import { CLUSTER_DOMAIN } from "../../lib/config.js";
import { createHTTPRoute } from "../../lib/gateway-api.js";
import { createNamespace } from "../../lib/namespace.js";
import { createSealedSecret } from "../../lib/sealed-secret.js";

const NAMESPACE = "ai-base";
const STACK_NAME = "langflow";
const PROJECT_NAME = "ai-base";
const PG_NAME = "langflow-postgresql";

/**
 * ns: ai-base
 *
 * AI関連システムの基盤システム
 */
export class AIBaseSystemChart extends Chart {
  constructor( scope: App ) {
    super( scope, NAMESPACE );

    createNamespace( this, NAMESPACE );
    createAppProject( this, "ai-base", {
      name: PROJECT_NAME,
      description: "AIアプリ開発基盤",
      sourceRepos: [ "ghcr.io/bjw-s-labs/helm" ],
      destinations: [
        {
          server: "https://kubernetes.default.svc",
          namespace: NAMESPACE,
        },
      ],
      clusterResourceWhitelist: [ { group: "*", kind: "*" } ],
    } );

    const secret = createSealedSecret( this, {
      name: PG_NAME,
      namespace: NAMESPACE,
      encryptedData: {
        POSTGRES_PASSWORD:
          "AgA0duwegXv1yaOF2Ad9ljSV6DiXuYNcCvUagW/q31SQlCZM2lrZcarOHT9Nelso/0FgWUrThXzOS+ki7MYIVyECEtzTl6FBimYt59nVMIBCc0AiLA14Y/pVGsZ/1eFi3MIa/TfgbXmYRe98UpyF+fm/zCuY4s+Fea1hoOvq6WDHgKejUkXdGIvx0DxHLCwsea9RedLvvJmmVMC882/t193s1UxRNjGyCxciPKK5WKUtwPtxAFK38LSWAhCvUP8jY8htb9UZcIIXKFSaM6jjru4dMZdSIcsGi+F3cafMcCNWre4fw5QmneiN+gCdp4htY+ESCtccpeJF+fWnnPmfJACWaHLJx93cyWo0FiF5GY9p00HzJ5WmzpKF8kk2bB7/CdZ8wg7Ansqp053zSmdF2dKTgZbTWrMqv874alzX0UtfBRNMRtOPpf4kj88GhZveKeJnNUwiwFMzyMl8GBJF8wM/h2Kx2jn+xVqHYwKtt/vOqVjDGXT43z89m0XzlTSgfj+jNXruavrnZk0XT+PiKbhkuJtZ8+sc0tjZBSzLkPbXgIXJa/YJVOhLm5FFXkozvfppUkRhPxuvmzeJ4pSbxOM02oKjKRjAXBA23joiwrQdaXmnIr1Q5YJFBpZv+L/J7NAx7PrFTLTcWszdkW4+/ommGDY2YA4Z/sXgATbIIwWFIH1+6D3jwCkjWQnwaurr4V1rKUDmKbQ5F0QC5ad5sUkMgA==",
      },
    } );

    const langflowSecret = createSealedSecret( this, {
      name: "langflow-secret",
      namespace: NAMESPACE,
      encryptedData: {
        LANGFLOW_DATABASE_URL:
          "AgAQ0CG5b+zfAS64SD8UivUsfQm4zIv1si+yAwKQMXnU2G41wEHSo1Gz61C0yMwoz/oF/egggiWaahP7sa1QiejMskdzYECfRrOTjykD3yg4aOp/7E5DSGYfRgnO2MSPS5+j9L7U+WkyWXiRXHCJ5hrElhqmS+vwC0FX6ljs88qaqoPMMkH0RkyHgIJKYNFmI4UoCGFD5Q+DsWNsGrEHr3jetp/3uYtfyuohj8WBHEGMfLgjqDrQFe8y1Hryu177MLRD6aBVOSwmNRihU5CUuIoD9Q0WnnT1zsz/EtaNgxx0r6SyVaS0GsS0g4nPwoGE8KeSHPoA4FMqfus62nmdr80yy1cBQmMbsuYEnQ7SBfJC299eAL/aZVT1FCBTLb34TtgYyZu1U5hw1B0OjLBOc6AE98Cq51fuD0SUk8Af3l2mEZnOHG5jF9c3gQKFHZcIQqtfK2h3PFMi1wbvpi1w+aYUX17UwZKj4RiEFDMzTweHKLJ+BEmDKnd1W3rB9vmWo7cZWHw2bxcBYlcBWEqT6E/YTpicuCb+GGMCuWbYJCIg+c88SLJ2XbudEBd62uLI8XFp30oqg01IV6lUAoDAGLL2mwvb+2+LliuEVGIMacGVO6H03swUQkJAE2Gzd/z33hlZenqIExA9Zsoz5L8Jcza5jN5fFGkdPEIVehbQ/Y6ezIr6qF/bV49ILlfZ0NgYPoN+cbHgHVf/H6L3tgT7S2RIRNghNMFwkBx/h/yNnKwrFGQQLJFjsKufWcVqjGnPueLh4O2jqGjQe++3qhgQ4g==",
      },
    } );

    createHelmApplicationSet( this, "langflow-set", {
      name: "langflow-set",
      namespace: NAMESPACE,
      project: PROJECT_NAME,
      applications: [
        // PostgreSQL
        {
          kind: "container",
          name: "langflow-postgresql",
          controllerType: "statefulset",
          image: {
            repository: "registry.access.redhat.com/hi/postgresql",
            tag: "sha256:c811c689db21e3796160f5c9403862a685be58ce0692e85f05afd12c025a8bf3",
          },
          envFrom: [ { secretRef: { name: secret.name } } ],
          persistence: {
            data: {
              type: "persistentVolumeClaim",
              accessMode: "ReadWriteOnce",
              size: "10Gi",
              storageClass: "longhorn",
              retain: true,
              globalMounts: [ { path: "/var/lib/postgresql" } ],
            },
          },
          probes: {
            startup: {
              enabled: true,
              custom: true,
              spec: {
                exec: { command: [ "pg_isready" ] },
                periodSeconds: 5,
                failureThreshold: 60,
              },
            },
            readiness: {
              enabled: true,
              custom: true,
              spec: {
                exec: { command: [ "pg_isready" ] },
                periodSeconds: 10,
                timeoutSeconds: 5,
              },
            },
            liveness: {
              enabled: true,
              custom: true,
              spec: {
                exec: { command: [ "pg_isready" ] },
                periodSeconds: 30,
                timeoutSeconds: 5,
                failureThreshold: 6,
              },
            },
          },
          service: {
            ports: { postgresql: { port: 5432 } },
          },
        },
        // LangFlow
        {
          name: STACK_NAME,
          kind: "container",
          image: {
            repository: "docker.io/langflowai/langflow",
            tag: "1.11.5",
          },
          env: {
            LANGFLOW_AUTO_LOGIN: "true",
            LANGFLOW_SSRF_ALLOWED_HOSTS: "192.168.0.0/22,*.home.internal",
          },
          envFrom: [ { secretRef: { name: langflowSecret.name } } ],
          service: {
            ports: {
              http: { port: 7860 },
            },
          },
        },
      ],
    } );

    // LangflowをHTTPとして公開する
    createHTTPRoute( this, {
      name: "langflow-route",
      namespace: NAMESPACE,
      hostnames: [ `${ STACK_NAME }.${ CLUSTER_DOMAIN }` ],
      backendRefs: [ { name: STACK_NAME, port: 7860 } ],
    } );
  }
}
