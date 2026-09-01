# Diagrams (Mermaid)

These diagrams render automatically in GitHub, GitLab, Obsidian, and VS Code.

---

## System Architecture

```mermaid
flowchart TB
    subgraph Hosts["Host apps"]
        RN[React Native app<br/>esign-react-native: WebView]
        WEB[React web app<br/>esign-react: iframe / DocuSign.js]
    end

    subgraph Core["esign-core (shared)"]
        SRC{SigningSource}
        PROXY[createProxySigningSource<br/>Apollo - proxy mode only]
        WF[createWebFormsSource]
        PUB[createPublicUrlSource]
    end

    subgraph Backend["Backend (apps/api) - proxy + Web Forms modes"]
        GQL[/"GraphQL /graphql"/]
        WFI[/"POST /webform/instance"/]
        WH[/"POST /webhook/esign"/]
        SP[/"signing pages + return-URL bridge"/]
        PROV{ESignProvider}
        DS[DocuSignProvider]
        MOCK[MockProvider]
        KNEX[Knex.js]
    end

    subgraph External["External"]
        DOCU[DocuSign API<br/>eSignature + Web Forms]
        DB[(PostgreSQL)]
    end

    RN --> SRC
    WEB --> SRC
    SRC --> PROXY & WF & PUB
    PROXY -->|GraphQL| GQL
    WF -->|one REST call| WFI
    GQL --> PROV
    WFI --> PROV
    PROV --> DS & MOCK
    DS -->|REST| DOCU
    DOCU -->|webhooks| WH
    GQL --> KNEX
    WH --> KNEX
    KNEX --> DB
    RN -.->|embedded signing| SP
```

The public-URL mode needs no backend at all; Apollo/GraphQL is loaded only
by the proxy source (the `/webform` package entries never reach it).

---

## Data Flow Diagram (proxy mode)

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
    START([Start]) --> TAP[User taps Sign]
    TAP --> NET{Online?}
    NET -->|No| OFFLINE[Offline state<br/>Check Connection]
    OFFLINE --> NET
    NET -->|Yes| LOADING[Loading]
    LOADING --> CREATE[source.start - proxy: createEnvelope<br/>webform: mint instance URL<br/>public: static URL]
    CREATE --> SUCCESS{Success?}

    SUCCESS -->|Yes| WEBVIEW[Signing page in WebView/iframe]
    SUCCESS -->|No| ERROR[Error state - Retry]

    WEBVIEW --> SIGN[User signs]
    SIGN --> EVENT{Signing event}

    EVENT -->|complete| SHOW_SUCCESS[Success screen<br/>then onComplete]
    EVENT -->|cancel| CANCEL[onCancel]
    EVENT -->|decline| DECLINE[onError DECLINED]
    EVENT -->|sessionExpired| TIMEOUT[Error state - Restart]

    TIMEOUT -->|restartable source<br/>proxy: getSigningUrl| WEBVIEW
    TIMEOUT -->|not restartable| LOADING
    ERROR -->|Retry| LOADING

    SHOW_SUCCESS --> END_SUCCESS([End])

    style START fill:#b2f2bb
    style END_SUCCESS fill:#b2f2bb
    style ERROR fill:#ffc9c9
    style CANCEL fill:#ffec99
    style TIMEOUT fill:#ffec99
    style OFFLINE fill:#ffec99
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
        string action "initiated|completed|failed|voided|declined|session_restart|creation_failed"
        datetime timestamp
        json metadata "nullable - sanitized allow-list, no PII"
    }
```

---

## Component Hierarchy

```mermaid
flowchart TB
    subgraph App["Demo App.tsx (host)"]
        AP[ApolloProvider - proxy mode only]
        SAP[SafeAreaProvider]

        subgraph Content["AppContent"]
            ES[ESignature source=SigningSource]

            subgraph States["Component states"]
                IDLE[idle: Sign button]
                LOAD[loading: spinner]
                SIGNING[signing: WebView]
                SUCCESS[success: confirmation]
                ERR[error: retry / restart]
                OFF[offline: check connection]
            end
        end
    end

    AP --> SAP
    SAP --> Content
    ES --> States

    IDLE -->|tap| LOAD
    IDLE -->|no connectivity| OFF
    OFF -->|reconnected| IDLE
    LOAD -->|session url| SIGNING
    LOAD -->|error| ERR
    SIGNING -->|complete| SUCCESS
    SIGNING -->|cancel| IDLE
    SIGNING -->|sessionExpired| ERR
    ERR -->|restart via source| SIGNING
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

---

## Web Forms Mode Flow

```mermaid
sequenceDiagram
    participant App as Host app (RN or web)
    participant BE as Backend (/webform/instance)
    participant PROV as ESignProvider
    participant DS as DocuSign Web Forms API
    participant WV as WebView / iframe

    App->>BE: POST /webform/instance (Bearer token)
    BE->>PROV: createWebFormInstance(userId, prefill)
    alt mock provider
        PROV-->>BE: local mock web-form URL
    else DocuSign provider
        PROV->>DS: createInstance(clientUserId, formValues)
        DS-->>PROV: formUrl + instanceToken (~5 min TTL)
        PROV-->>BE: formUrl#instanceToken=...
    end
    BE-->>App: { url }
    App->>WV: embed url
    WV-->>App: sessionEnd event (signingResult / formConfirmation / sessionTimeout)
    Note over App: interpretDocuSignEvent normalizes to complete / cancel / sessionExpired
```
