import { sec, type LegalDoc } from "./types";

// Verbatim from design/public/Nutrivo Legal - Terms, DPA, Privacy.dc.html (const PRIVACY). Never edit the wording here:
// it is a draft pending Swedish counsel (D-20). The only changes are the hosting and sub-processor entries compared
// with docs/09-security.md and docs/02-decisions.md (plan on issue #60, question 5); each carries a comment.
export const PRIVACY: LegalDoc = {
  tab: "Privacy policy",
  kicker: "Privacy policy · draft 1.0",
  title: "Privacy policy",
  intro: "How Sunny Ventures AB, trading as Nutrivo.ai, handles personal data. It covers the data we hold for our own purposes as a controller, and explains where the data inside a customer's workspace is governed by that customer instead.",
  facts: [
    { k: "Controller", v: "Sunny Ventures AB, Stockholm" },
    { k: "Contact", v: "privacy@nutrivo.ai" },
    // Design: "Ireland · European Union". docs/02-decisions.md D-02 (line 9) hosts in "Supabase eu-central-1
    // (Frankfurt)" and says "customers are promised the EU, not one city", so Ireland is dropped.
    { k: "Data held in", v: "European Union" },
    { k: "Supervisory authority", v: "IMY, Sweden" },
  ],
  contactLine: "Privacy questions and data subject requests: privacy@nutrivo.ai",
  version: "VERSION 1.0 DRAFT · 5 SEPTEMBER 2026 · WE WILL PUBLISH THE DATE OF EVERY LATER CHANGE",
  sections: [
    sec("01", "Two different situations", "Nutrivo holds personal data in two capacities, and which one applies changes who you should ask about it.", [
      { n: "1.1", v: "For the people who visit our website, sign up, administer a workspace or pay us, we are the controller. This policy describes that processing." },
      { n: "1.2", v: "For the material inside a customer's workspace — their products, their artwork, the colleagues and consultants they admit — the customer is the controller and we are their processor. We process it on their instructions under a data processing agreement, and a request about it should go to them. If a request reaches us we will pass it on and tell you we have." },
      { n: "1.3", v: "We are a business-to-business service. We do not knowingly process the data of anybody under eighteen, and the service has no consumer-facing part." },
    ]),
    sec("02", "What we hold as controller, and why", null, [], {
      head: ["Data", "Purpose and legal basis", "Kept for"],
      rows: [
        ["Name, business email, company, role", "Providing the service and administering your account. Performance of a contract, Article 6(1)(b)", "While the account exists, then twelve months"],
        ["Authentication data, sign-in times, devices, IP address", "Letting you in and keeping others out. Legitimate interest in security, Article 6(1)(f)", "Twelve months"],
        ["Billing entity, address, VAT number, payment records, invoices", "Charging you and meeting accounting obligations. Contract and legal obligation, Article 6(1)(b) and (c)", "Seven years, per Swedish accounting law"],
        ["Support correspondence", "Answering you and improving the service. Legitimate interest, Article 6(1)(f)", "Three years"],
        ["Which features a workspace uses, in aggregate", "Understanding what to build. Legitimate interest, Article 6(1)(f)", "Aggregated, not tied to a person"],
        ["Business email given for a trial or for product news", "Telling you about the service. Legitimate interest with an unsubscribe in every message, Article 6(1)(f)", "Until you unsubscribe, then a suppression record"],
      ],
    }),
    sec("03", "What we do not do", null, [
      { n: "3.1", v: "We do not sell personal data, and we do not share it with anybody for their own marketing." },
      { n: "3.2", v: "We do not use advertising trackers or third-party marketing cookies on our website, so there is no consent banner to dismiss. We use one session cookie to keep you signed in and a small number of first-party measurements that do not identify a person." },
      { n: "3.3", v: "We do not use a customer's product data, artwork or results to train models for the benefit of other customers, and our model providers are engaged on terms that prohibit training on what we send them." },
      { n: "3.4", v: "We do not profile individuals and we take no automated decision with legal effect on a person. The service assesses products against rules." },
    ]),
    sec("04", "Where the data is", null, [
      // Design: "hosted in Ireland". D-02 (docs/02-decisions.md line 9): "Supabase eu-central-1 (Frankfurt)".
      { n: "4.1", v: "Customer workspaces and the personal data in them are hosted in eu-central-1 (Frankfurt), within the European Union, on managed infrastructure provided by Supabase running on Amazon Web Services." },
      { n: "4.2", v: "Our own controller data sits in the same place, apart from payment data held by our payment provider and correspondence held in our business systems, both within the European Union or under Standard Contractual Clauses." },
      { n: "4.3", v: "Where a processor is established outside the European Economic Area or may access data from outside it, the transfer is made under the Standard Contractual Clauses adopted by the European Commission, with a transfer impact assessment and any supplementary measures it identifies." },
      { n: "4.4", v: "The current list of processors is published in the data processing agreement, and we give thirty days' notice before adding or replacing one." },
    ]),
    sec("05", "Your rights", null, [
      { n: "5.1", v: "You may ask for a copy of the personal data we hold about you, ask us to correct it, ask us to delete it, ask us to restrict how we use it, object to processing we carry out on the basis of legitimate interest, and ask for it in a portable form." },
      { n: "5.2", v: "Write to privacy@nutrivo.ai. We answer within one month, and we will tell you if a request will take longer and why. There is no charge for a reasonable request." },
      { n: "5.3", v: "Two limits are worth stating plainly. Data we must keep for accounting cannot be deleted before the statutory period ends. And a record of who ran a check or signed a document cannot be altered, because the record's integrity is the point of it; we keep only a name, a role and a timestamp for that purpose." },
      { n: "5.4", v: "If a request concerns material inside a customer's workspace, that customer is the controller and we will refer you to them." },
      { n: "5.5", v: "You may complain to the Swedish Authority for Privacy Protection, Integritetsskyddsmyndigheten, Box 8114, 104 20 Stockholm, imy@imy.se. We would rather you told us first, but the right is yours either way." },
    ]),
    sec("06", "Security", null, [
      { n: "6.1", v: "Access is per individual with a second factor available on every account and required for anybody holding signing authority. Each customer's data is separated from every other in the database itself rather than by application code." },
      { n: "6.2", v: "Data is encrypted in transit and at rest. Backups are encrypted, retained for thirty days and then overwritten." },
      { n: "6.3", v: "Compliance records are append-only. They cannot be edited or deleted by a customer or by us, which is a security property as much as a product one." },
      { n: "6.4", v: "If a breach affects your personal data we will tell you and the supervisory authority as the law requires, and we will say what happened rather than only that something did." },
    ]),
    sec("07", "Changes and contact", null, [
      { n: "7.1", v: "When we change this policy we publish the new version with its date and keep the previous ones available. Where a change is material we tell account administrators by email before it takes effect." },
      { n: "7.2", v: "For anything about personal data, write to privacy@nutrivo.ai. For a suspected security problem, security@nutrivo.ai — we will acknowledge within one working day. We have not appointed a data protection officer, as we are not required to; privacy@nutrivo.ai reaches the person responsible." },
    ]),
  ],
};
