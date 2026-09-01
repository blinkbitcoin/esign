# Diagrams (Mermaid)

These diagrams render automatically in GitHub, GitLab, Obsidian, and VS Code.

---

## System Architecture

```mermaid
flowchart TB
    subgraph Mobile["📱 Mobile App"]
        direction TB
        RN[React Native 0.86.0]
        ES[ESignature Component]
        AC[Apollo Client 4.2]
        WV[WebView]
    end

    subgraph Backend["🖥️ Backend"]
        direction TB
        EX[Express 5.2]
        AS[Apollo Server 5.5]
        GQL[/GraphQL\n/graphql/]
        WH[/Webhook\n/webhook/esign/]
        PR[Knex.js 3.3]
        PROV{ESignProvider}
        DS[DocuSignProvider]
        MOCK[MockProvider]
    end

    subgraph External["☁️ External"]
        DOCU[📝 DocuSign API]
        DB[(PostgreSQL)]
    end

    ES --> AC
    ES --> WV
    AC -->|GraphQL| GQL
    GQL --> PROV
    PROV --> DS
    PROV --> MOCK
    DS -->|REST API| DOCU
    DOCU -->|Webhooks| WH
    WH --> PR
    GQL --> PR
    PR --> DB
    WV -.->|Embedded Signing| DOCU
```

---

## Data Flow Diagram

```mermaid
flowchart LR
    U((👤 User))

    subgraph P1[1.0 Mobile App]
        direction TB
        p1a[Show UI]
        p1b[Handle Events]
    end

    subgraph P2[2.0 Backend API]
        direction TB
        p2a[GraphQL Resolvers]
        p2b[Provider Logic]
    end

    subgraph P3[3.0 DocuSign]
        direction TB
        p3a[Create Envelope]
        p3b[Generate URL]
    end

    subgraph P4[4.0 Webhook Handler]
        direction TB
        p4a[Validate HMAC]
        p4b[Update Status]
    end

    D1[(D1 Database)]

    U -->|Tap Sign| P1
    P1 -->|createEnvelope| P2
    P2 -->|API Call| P3
    P3 -->|Signing URL| P2
    P2 -->|Store Envelope| D1
    P2 -->|URL + ID| P1
    P1 -->|WebView| U
    P3 -->|Event| P4
    P4 -->|Update| D1
```

---

## Signing Flow Process

```mermaid
flowchart TD
    START([Start]) --> TAP[User Taps Sign]
    TAP --> LOADING[Show Loading]
    LOADING --> CREATE[Call createEnvelope<br/>GraphQL Mutation]
    CREATE --> SUCCESS{Success?}

    SUCCESS -->|Yes| WEBVIEW[Load DocuSign<br/>WebView]
    SUCCESS -->|No| ERROR[Show Error]

    WEBVIEW --> SIGN[User Signs Document]
    SIGN --> EVENT{Event Type?}

    EVENT -->|signing_complete| SHOW_SUCCESS[Show Success]
    EVENT -->|cancel| CANCEL[Handle Cancel]
    EVENT -->|decline| DECLINE[Handle Decline]
    EVENT -->|session_timeout| TIMEOUT[Session Expired]

    SHOW_SUCCESS --> END_SUCCESS([End - Success])
    CANCEL --> END_CANCEL([End - Cancelled])
    DECLINE --> END_DECLINE([End - Declined])
    TIMEOUT --> RETRY{Retry?}
    RETRY -->|Yes| LOADING
    RETRY -->|No| END_TIMEOUT([End - Timeout])
    ERROR --> END_ERROR([End - Error])

    style START fill:#b2f2bb
    style END_SUCCESS fill:#b2f2bb
    style ERROR fill:#ffc9c9
    style END_ERROR fill:#ffc9c9
    style END_DECLINE fill:#ffc9c9
    style CANCEL fill:#ffec99
    style END_CANCEL fill:#ffec99
    style TIMEOUT fill:#ffec99
    style END_TIMEOUT fill:#ffec99
```

---

## Database ERD

```mermaid
erDiagram
    Envelope ||--o{ AuditLog : "has many"

    Envelope {
        uuid id PK
        string providerEnvelopeId UK "Unique"
        string userId
        string contractType
        string status "sent|completed|voided|declined"
        datetime createdAt
        datetime updatedAt
    }

    AuditLog {
        uuid id PK
        uuid envelopeId FK
        string action "initiated|completed|failed|voided|declined"
        datetime timestamp
        json metadata "nullable"
    }
```

---

## Component Hierarchy

```mermaid
flowchart TB
    subgraph App["App.tsx"]
        AP[ApolloProvider]
        SAP[SafeAreaProvider]

        subgraph Content["AppContent"]
            ES[ESignature]

            subgraph States["Component States"]
                IDLE[idle: Sign Button]
                LOAD[loading: Spinner]
                SIGNING[signing: WebView]
                SUCCESS[success: Confirmation]
                ERR[error: Error Message]
            end
        end
    end

    AP --> SAP
    SAP --> Content
    ES --> States

    IDLE -->|tap| LOAD
    LOAD -->|url received| SIGNING
    LOAD -->|error| ERR
    SIGNING -->|complete| SUCCESS
    SIGNING -->|cancel/decline| IDLE
```

---

## Webhook Flow

```mermaid
sequenceDiagram
    participant DS as DocuSign
    participant WH as Webhook Handler
    participant DB as Database
    participant AL as Audit Logger

    DS->>WH: POST /webhook/esign
    Note over WH: X-DocuSign-Signature-1 header

    WH->>WH: provider.verifyWebhook() - HMAC-SHA256 over raw body

    alt Invalid Signature
        WH-->>DS: 401 Unauthorized
    else Valid Signature
        WH->>WH: provider.parseWebhookEvent()
        alt Malformed payload
            WH-->>DS: 400 Invalid payload
        else Parsed event
            WH->>DB: Find envelope by providerEnvelopeId
            Note over WH,AL: Status update + audit log in one transaction
            WH->>DB: Update status
            WH->>AL: Create audit log entry
            alt Transient failure (e.g. DB outage)
                WH-->>DS: 500 (DocuSign retries; handler is idempotent)
            else Success or ignorable (unknown envelope/status, duplicate)
                WH-->>DS: 200 OK
            end
        end
    end
```

---

## GraphQL Request Flow

```mermaid
sequenceDiagram
    participant App as Mobile App
    participant AC as Apollo Client
    participant GQL as GraphQL Server
    participant PROV as ESignProvider
    participant DS as DocuSign API
    participant DB as Database

    App->>AC: createEnvelope mutation
    AC->>GQL: POST /graphql (Bearer token)
    GQL->>GQL: Resolve userId (JWT / dev passthrough)
    GQL->>PROV: createEnvelope()
    PROV->>DS: Create envelope
    DS-->>PROV: Envelope ID
    PROV->>DS: Get signing URL
    DS-->>PROV: Signing URL
    PROV-->>GQL: { envelopeId, signingUrl }
    GQL->>DB: Store envelope + 'initiated' audit log (transaction)
    DB-->>GQL: Saved (internal UUID)
    GQL-->>AC: { envelopeId: internal UUID, signingUrl }
    AC-->>App: Result
```
