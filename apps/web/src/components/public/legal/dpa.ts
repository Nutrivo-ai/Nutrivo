import { sec, type LegalDoc } from "./types";

// Verbatim from design/public/Nutrivo Legal - Terms, DPA, Privacy.dc.html (const DPA). Never edit the wording here:
// it is a draft pending Swedish counsel (D-20). The only changes are the hosting and sub-processor entries compared
// with docs/09-security.md and docs/02-decisions.md (plan on issue #60, question 5); each carries a comment.
export const DPA: LegalDoc = {
  tab: "Data processing agreement",
  kicker: "Data processing agreement · draft 1.0",
  title: "Data processing agreement",
  intro: "The agreement under Article 28 of the General Data Protection Regulation between you as controller and Sunny Ventures AB as processor. It applies whenever we process personal data on your behalf, and it forms part of the terms of service.",
  facts: [
    { k: "Controller", v: "You, the customer" },
    { k: "Processor", v: "Sunny Ventures AB" },
    // Design: "Ireland · European Union". docs/02-decisions.md D-02 (line 9) hosts in "Supabase eu-central-1
    // (Frankfurt)" and says "customers are promised the EU, not one city", so Ireland is dropped.
    { k: "Processing location", v: "European Union" },
    { k: "Transfers outside the EEA", v: "None for hosting" },
  ],
  contactLine: "Data protection: privacy@nutrivo.ai · Security incidents: security@nutrivo.ai",
  version: "VERSION 1.0 DRAFT · 5 SEPTEMBER 2026 · ANNEXES I AND II FORM PART OF THIS AGREEMENT",
  sections: [
    sec("01", "Roles and scope", null, [
      { n: "1.1", v: "You are the controller of the personal data you submit to the service and of the personal data of the people you admit to your workspace. We are the processor of that data and process it only on your instructions." },
      { n: "1.2", v: "We are an independent controller for a limited set of data we process for our own purposes: the identity and contact details of the people who administer and pay for a workspace, billing records we are required to keep, and the security and operational logs we need to run the service. That processing is described in the privacy policy, not here." },
      { n: "1.3", v: "This agreement applies for as long as we process personal data on your behalf, and prevails over the terms of service on any question about the processing of personal data." },
      { n: "1.4", v: "Your instructions are given by your use of the service and by the settings you choose in it. If we consider an instruction to be in breach of data protection law, we will tell you and may suspend the processing concerned until it is resolved." },
    ]),
    sec("02", "The processing", "The details required by Article 28(3) are set out here and in Annex I. The processing is characteristically light on personal data: the service is about products and rules, and the people in it are a small number of named professionals.", [
      { n: "2.1", v: "Subject matter: the provision of regulatory compliance checking of product labels, recipes and records, and the documents produced from it." },
      { n: "2.2", v: "Duration: for the term of the subscription, and afterwards only for the retention periods stated in Annex I and in section 8." },
      { n: "2.3", v: "Nature and purpose: storing, reading, analysing and reporting on the material you submit; identifying and authenticating your people; recording who did what; and producing, sharing and verifying documents at your instruction." },
      { n: "2.4", v: "We do not carry out automated decision-making with legal effect on a person, and we do not profile. The service assesses products, not people." },
      { n: "2.5", v: "You must not submit special category data or criminal offence data to the service. It is not designed for it and there is no purpose for which it would be needed." },
    ], {
      head: ["Category of person", "Categories of data", "Why it is processed"],
      rows: [
        ["Your people, and external consultants you admit", "Name, business email, role, scope, access dates, actions taken with timestamps, authentication data", "Access control, and the append-only record of who did what"],
        ["Your suppliers' contacts", "Business email, company, the document requested and uploaded", "Requesting and receiving specifications by scoped link, without an account"],
        ["Recipients of a document you send", "Business email, the fact and time of sending, whether a reference was verified", "Delivering a document you chose to send, and answering verification"],
        ["Individuals named in your own material", "Whatever appears in artwork or documents you upload, typically a responsible operator's contact details", "Because it is on the label; we neither seek nor use it beyond the check"],
      ],
    }),
    sec("03", "Security", "The measures are listed in Annex II. Three of them are load-bearing and are stated here because they are architectural rather than operational.", [
      { n: "3.1", v: "Tenant separation is enforced in the database itself, by row-level security policies keyed to your workspace, rather than by application code. A defect in the application cannot expose one customer's data to another." },
      { n: "3.2", v: "The event store and the certificate chain accept inserts only. Update and delete rights are revoked from every application role and rejected at the database level. Neither we nor you can alter a historical record." },
      { n: "3.3", v: "The public verification endpoint has no read access to customer tables. It returns a document's status, issue date and ruleset version against an unguessable reference, and never its content, its findings or your identity beyond what is on the document itself." },
      { n: "3.4", v: "Data is encrypted in transit with TLS and at rest. Access by our personnel is limited to named individuals who need it, is authenticated with a second factor, and is logged." },
      { n: "3.5", v: "We will not materially reduce the measures in Annex II during the term. We may change how a measure is implemented, provided the level of protection is maintained." },
    ]),
    sec("04", "Our personnel", null, [
      { n: "4.1", v: "Only personnel who need access to provide, secure or support the service are given it, and only to the extent needed." },
      { n: "4.2", v: "Every person with access is bound by a written confidentiality obligation that survives the end of their engagement." },
      { n: "4.3", v: "We do not access the content of your workspace to answer a support request unless you ask us to, and such access is recorded." },
    ]),
    sec("05", "Sub-processors", null, [
      { n: "5.1", v: "You give general authorisation for us to engage the sub-processors listed below. We remain responsible to you for their performance." },
      { n: "5.2", v: "We will give thirty days' notice before adding or replacing a sub-processor. If you reasonably object on data protection grounds you may terminate the affected part of the service without penalty, and we will refund the unused part of any prepaid term." },
      { n: "5.3", v: "Every sub-processor is bound by obligations no less protective than those in this agreement." },
    ], {
      head: ["Sub-processor", "What it does", "Where it processes"],
      // Each row compared with docs/09-security.md "Sub-processors as deployed" (lines 58-62) and docs/02-decisions.md
      // D-02 (line 9), D-16 (line 23). No vendor is added: docs/09 also lists Vercel, Render, Sentry, PostHog and
      // Langfuse, which the design does not draw (a question for a founder, not a decision made here).
      rows: [
        // Design: "Supabase (Supabase Inc., on Amazon Web Services infrastructure)" · "Ireland · eu-west-1".
        // docs/09 line 59: "Supabase (AWS eu-central-1)"; D-02: "Supabase eu-central-1 (Frankfurt)". The legal entity
        // "Supabase Inc." is in neither doc and is omitted.
        ["Supabase (on Amazon Web Services infrastructure)", "Database, authentication, file storage, realtime updates", "eu-central-1 (Frankfurt)"],
        // Design row "Amazon Web Services EMEA SARL" · "Underlying compute, storage and network" · "Ireland · eu-west-1"
        // is omitted: docs/09 names no AWS compute, storage or network sub-processor (Supabase runs on AWS in
        // eu-central-1, the worker on Render, functions on Vercel), and the docs contradict Ireland.
        // Design: "An EU-established transactional email provider" · "European Union". docs/09 line 59 and D-16:
        // "AWS SES (eu-central-1)".
        ["AWS SES", "Delivering documents you send, invitations and notifications", "eu-central-1"],
        // Design: "Stripe Payments Europe Ltd" · "Ireland, with transfers under its own safeguards". docs/09 line 60
        // names "Stripe" with no entity and no location, so the entity and the location are omitted.
        ["Stripe", "Card payment processing and invoicing", ""],
        // Design: "A model provider for the assistant and for extraction" · "European Union where the provider offers
        // EU processing". D-02 (line 9): "The DPA names "AWS Bedrock, EU Regions""; docs/09 line 59 the same.
        ["AWS Bedrock", "Model inference on the text you submit, under a no-training commitment", "EU Regions"],
      ],
    }),
    sec("06", "Transfers outside the EEA", null, [
      // Design: "hosted in Ireland". D-02 (docs/02-decisions.md line 9): "Supabase eu-central-1 (Frankfurt)".
      { n: "6.1", v: "Your workspace is hosted in eu-central-1 (Frankfurt) and the processing of your material takes place within the European Union. We do not transfer it outside the European Economic Area for hosting or for backup." },
      { n: "6.2", v: "Where a sub-processor is established outside the EEA or may access data from outside it, the transfer is made under the Standard Contractual Clauses adopted by the European Commission, together with a transfer impact assessment and any supplementary measures it identifies." },
      { n: "6.3", v: "We will tell you if we ever need to change the hosting region, with the notice period in section 5.2, and you may object on the same basis." },
    ]),
    sec("07", "Your rights and obligations, and ours", null, [
      { n: "7.1", v: "We will assist you in responding to a request from a data subject. Because you control your workspace, you can find, correct and export most such data yourself; where you cannot, we will help within a reasonable time and without charge for a reasonable volume of requests." },
      { n: "7.2", v: "Where a data subject's request would require altering an append-only record, we will tell you so and explain what can and cannot be done. A record of who ran a check is retained on the legal basis of our legitimate interest and yours in the integrity of a compliance record, and it is a small and proportionate amount of data." },
      { n: "7.3", v: "We will notify you without undue delay, and in any event within forty-eight hours of becoming aware, of a personal data breach affecting your data, with the information you need for your own notification obligations under Articles 33 and 34." },
      { n: "7.4", v: "We will assist you with a data protection impact assessment and with a prior consultation, to the extent the processing under this agreement is relevant to it." },
      { n: "7.5", v: "You may audit our compliance with this agreement once in any twelve-month period, on thirty days' notice, at your own cost, and subject to confidentiality. We may satisfy an audit by providing a current third-party report or completed security questionnaire where it answers your questions." },
    ]),
    sec("08", "Deletion and return", null, [
      { n: "8.1", v: "On termination you may export everything, and we will delete or return personal data at your choice, subject to the exceptions in 8.2 and 8.3." },
      { n: "8.2", v: "We retain the minimum record needed to keep answering the public verification page for documents you shared before termination, because a third party may still hold one and its unverifiability would be a harm to them. That record is a reference, a status, a date and a ruleset version." },
      { n: "8.3", v: "We retain billing records for the period required by Swedish accounting law, currently seven years, and we retain the append-only event record for the periods in Annex I." },
      { n: "8.4", v: "Backups are retained on a rolling basis for thirty days and are then overwritten. A deletion request is executed against live systems immediately and takes effect in backups as they roll." },
    ]),
    sec("09", "Annex I · retention", "Retention is stated per kind of record rather than as one period, because the reasons differ.", [], {
      head: ["Record", "Retained for", "Why"],
      rows: [
        ["Checks, findings and results", "For the life of the workspace, and beyond it as in 8.2", "It is an append-only compliance record"],
        ["Reports and certificates", "Permanently, as a reference and status", "A third party may hold a copy that has to verify"],
        ["Artwork files you upload", "While the product is active, then two years", "The extracted text and identifier are kept; the file itself is not needed"],
        ["Supplier documents", "While current, then six years after expiry", "The span most audits reach back over"],
        ["Access and audit events", "For the life of the workspace", "The integrity of the record depends on it"],
        ["Billing records", "Seven years", "Swedish accounting law"],
        ["Security and operational logs", "Twelve months", "Investigating incidents"],
      ],
    }),
    sec("10", "Annex II · technical and organisational measures", null, [
      { n: "10.1", v: "Access control: individual credentials, second factor available on every account and required for anybody holding signing authority, role and scope enforced per workspace, immediate revocation, optional end dates on external access." },
      { n: "10.2", v: "Tenant separation: row-level security in the database keyed to the workspace, applied to every table holding customer data." },
      { n: "10.3", v: "Integrity: insert-only event and certificate tables with update and delete revoked from all application roles and rejected by a database trigger; documents pinned to ruleset version and artwork identifier." },
      { n: "10.4", v: "Encryption: TLS in transit; encryption at rest for the database, file storage and backups." },
      { n: "10.5", v: "Segregation of environments: no customer data in development or test environments." },
      { n: "10.6", v: "Availability: managed database with point-in-time recovery, daily backups retained thirty days, restore tested periodically." },
      { n: "10.7", v: "Personnel: confidentiality undertakings, need-to-know access, logged administrative access, security training on joining and annually." },
      { n: "10.8", v: "Vendor management: a written agreement and data protection terms with every sub-processor, and a review before any is added." },
      { n: "10.9", v: "Incident response: a defined process with named responsibility, notification to you within forty-eight hours of becoming aware, and a written account of cause and remediation." },
    ]),
  ],
};
