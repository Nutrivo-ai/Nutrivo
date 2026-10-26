import { sec, type LegalDoc } from "./types";

// Verbatim from design/public/Nutrivo Legal - Terms, DPA, Privacy.dc.html (const TERMS). Never edit the wording here:
// it is a draft pending Swedish counsel (D-20). The only changes are the hosting and sub-processor entries compared
// with docs/09-security.md and docs/02-decisions.md (plan on issue #60, question 5); each carries a comment.
export const TERMS: LegalDoc = {
  tab: "Terms and conditions",
  kicker: "Terms of service · draft 1.0",
  title: "Terms and conditions",
  intro: "The agreement between Sunny Ventures AB, trading as Nutrivo.ai, and the company that subscribes to the service. It sets out what the service does, what it deliberately does not do, and who is responsible for what.",
  facts: [
    { k: "Provider", v: "Sunny Ventures AB, Stockholm" },
    { k: "Governing law", v: "Swedish law" },
    { k: "Forum", v: "Stockholm District Court" },
    // Design: "European Union · Ireland". docs/02-decisions.md D-02 (line 9) hosts in "Supabase eu-central-1
    // (Frankfurt)" and says "customers are promised the EU, not one city", so Ireland is dropped.
    { k: "Processing location", v: "European Union" },
  ],
  contactLine: "Commercial and contractual: finance@nutrivo.ai · +46 76 347 03 92",
  version: "VERSION 1.0 DRAFT · 5 SEPTEMBER 2026 · SUPERSEDES NOTHING",
  sections: [
    sec("01", "Who these terms are between", null, [
      { n: "1.1", v: "The service is provided by Sunny Ventures AB, company registration number 5594297151, of Karlbergsvägen 48, 113 37 Stockholm, Sweden, which trades under the name Nutrivo.ai. In these terms \"we\" and \"Nutrivo\" mean that company." },
      { n: "1.2", v: "\"You\" means the company or other legal person named as the customer in the workspace's billing details. Where an individual accepts these terms, they confirm that they are authorised to bind that company." },
      { n: "1.3", v: "The service is offered to businesses only. It is not offered to consumers, and the Swedish Consumer Sales Act and the Distance Contracts Act do not apply to it." },
      { n: "1.4", v: "These terms, the Data Processing Agreement, the privacy policy and the plan and price in effect for your workspace together form the whole agreement. Where they conflict, the Data Processing Agreement prevails on the processing of personal data and these terms prevail on everything else." },
    ]),
    sec("02", "What the service does", "Nutrivo checks label artwork, recipes and product records against regulatory rules we have encoded for named jurisdictions, and reports what it finds.", [
      { n: "2.1", v: "Every result is reported in one of four states: clear, action needed, not assessed, or blocked. \"Not assessed\" means we did not check something, and it is reported as prominently as any other state. The service never reduces a result to a pass or a fail." },
      { n: "2.2", v: "Every result carries its provenance: whether it came from a deterministic rule, from a model judgement, or from nothing at all because the point was not assessed. Provenance is part of the result and is not optional." },
      { n: "2.3", v: "Where we hold no rules for a jurisdiction, or hold them only in part, the affected result is withheld and links to the coverage statement that names the method, the date and the gap. A jurisdiction for which we hold no rules can never return a clear result." },
      { n: "2.4", v: "We publish the depth of our coverage per jurisdiction, including what is not covered. Published coverage is a statement of what we hold at a stated date, not a warranty of completeness or of currency at any later date." },
      { n: "2.5", v: "A check runs against the language in which the label is printed, for each jurisdiction in scope, on every plan including the free one. We do not check an English text and report the result as though it applied to another language." },
      { n: "2.6", v: "Checks and re-checks are not metered on any plan. Where a plan sets a limit, that limit is on what you manage in the service, not on how often you check it." },
    ]),
    sec("03", "What the service does not do", "This section is the most important in these terms. It states the boundary of what we sell, and it is not negotiable on any plan or at any price.", [
      { n: "3.1", v: "We do not represent you before any authority. We do not submit or file a registration, notification or application; we do not pay a fee on your behalf; we do not correspond with an authority about your product; and we do not act as your agent, importer, distributor or responsible operator." },
      { n: "3.2", v: "We do not confirm that a registration is valid, in force or accepted, and we do not guarantee that any authority will accept a product, a label, a claim or a submission. Only the operator named on the label can register a product, and only an authority can decide whether a registration stands." },
      { n: "3.3", v: "The service is not legal advice and does not create a lawyer-client relationship. A result is an assessment against rules we have encoded, not an opinion on your legal position." },
      { n: "3.4", v: "You remain responsible for the compliance of your products, for the accuracy of what you put into the service, and for every decision you take on the basis of a result. The service supports that responsibility; it does not assume it." },
      { n: "3.5", v: "A Report of Check states on its face that it was generated automatically and attested by nobody. A Certificate of Check is an internal attestation by a person in your own organisation who holds signing authority for the market in question. Neither is a certificate issued by us, by an authority or by a notified body, and neither is a qualified electronic signature or any other trust service under Regulation (EU) No 910/2014." },
    ]),
    sec("04", "Your account, your people and your suppliers", null, [
      { n: "4.1", v: "You are responsible for who you admit to your workspace, for the role and scope you give them, and for keeping that current. An administrator can remove access at any time and it ends immediately." },
      { n: "4.2", v: "A person marked external is somebody outside your company, such as a consultant. Their access may carry an end date, they are never offered signing authority, and every event they generate is recorded as external. Their role determines what they cost: an external person who edits consumes an editor seat; an external person who only reads does not." },
      { n: "4.3", v: "Suppliers and contract manufacturers may be given a scoped link to upload a document without holding an account. Such a link gives access to the specific request and to nothing else, and it is not charged for." },
      { n: "4.4", v: "Signing authority is granted to a named individual for named markets. It is not a role and it is not implied by any role, including administrator. You are responsible for granting it only to people who are authorised within your organisation to attest on its behalf." },
      { n: "4.5", v: "Each person must have their own credentials. Shared logins are not permitted, because the record of who did what is only worth what the identities behind it are worth." },
    ]),
    sec("05", "Records that cannot be altered", null, [
      { n: "5.1", v: "Checks, findings and certificates are recorded as events in an append-only store. They cannot be edited or deleted, by you or by us, because a record the application could rewrite would not be a record." },
      { n: "5.2", v: "A Report of Check and a Certificate of Check are pinned to the ruleset version, the artwork identifier and the time at which they were produced. A later change to the rules or to your artwork does not alter an existing report; it may mark it superseded." },
      { n: "5.3", v: "Where a document has been shared outside your organisation, we keep the record needed to answer the public verification page for that document, whether or not your subscription continues. Verification returns the document's status, its issue date and its ruleset version, and never its content." },
      { n: "5.4", v: "Products are not deleted. A product you no longer sell is marked discontinued, excluded from counts, freshness and monitoring, and retained so that documents issued against it stay resolvable." },
    ]),
    sec("06", "Plans, fees and payment", null, [
      { n: "6.1", v: "All prices are stated excluding value added tax. VAT is added on the invoice at the rate applicable to your workspace, determined by the country in your billing details and by whether you have given a valid VAT number." },
      { n: "6.2", v: "Fees are charged in advance, monthly or annually according to the plan you choose. An annual term is charged as ten months for twelve, and that discount is the same on every plan." },
      { n: "6.3", v: "A region is sold whole. You cannot subscribe to a single member state or a single US state, because a state is one edition of a national rulebook rather than a rulebook of its own." },
      { n: "6.4", v: "Where you exceed an allowance, the excess is charged at the rate published for your plan, and the total charge for a period will not exceed one and a half times the plan's list price. Beyond that we will offer you the next plan rather than continue to charge overage." },
      { n: "6.5", v: "A monthly subscription has no minimum term and may be cancelled with effect from the next renewal date. Fees already paid for a current period are not refunded, and an annual term is not refunded in part on early cancellation." },
      { n: "6.6", v: "If a payment fails we will notify you and retry. Access is not restricted for fourteen days from the first failure, after which the workspace stops accepting new label artworks. Nothing is deleted, everything already checked stays readable, and no document already shared stops verifying." },
      { n: "6.7", v: "We may change prices with sixty days' written notice, effective at your next renewal. A price change never applies within a term you have already paid for." },
    ]),
    sec("07", "The free allowance", null, [
      { n: "7.1", v: "The free allowance requires no payment card and carries no time limit. It covers the first three label artworks submitted to a workspace, and it gives the full service on each of them, including exporting, emailing, sharing by link and the public verification page." },
      { n: "7.2", v: "An artwork counts against the allowance once when it is first submitted. Re-checking the same artwork, checking it against further markets within your region, and checking a revised version of it are not charged against the allowance." },
      { n: "7.3", v: "Once the allowance is used, the workspace stops accepting a new label artwork until a plan starts. Nothing is removed: the three labels, their results, their history and any document you shared remain available and continue to verify." },
      { n: "7.4", v: "The free allowance is per workspace. Creating a further workspace to obtain a further allowance is not permitted, and we may decline to provide the service where that is what is happening." },
      { n: "7.5", v: "A workspace that nobody has opened for ninety days becomes dormant. It is not deleted, and documents shared from it continue to verify." },
    ]),
    sec("08", "Your material and ours", null, [
      { n: "8.1", v: "Everything you put into the service remains yours: your artwork, recipes, product records, documents and the results produced from them. We claim no ownership of it and no licence to it beyond what is needed to provide the service to you." },
      { n: "8.2", v: "We do not use your material to train models for the benefit of other customers, and we do not disclose it to another customer in any form, aggregated or otherwise." },
      { n: "8.3", v: "The service itself, including the encoded rulesets, the coverage records, the term register and the software, remains ours. Your subscription is a right to use it, not a transfer of it." },
      { n: "8.4", v: "You may export your material at any time, on any plan including the free one, at no charge." },
      { n: "8.5", v: "You warrant that you have the right to submit the material you submit, and that doing so does not infringe a third party's rights." },
    ]),
    sec("09", "Availability, support and change", null, [
      { n: "9.1", v: "We aim for the service to be available at all times but do not offer a service level commitment on the plans published as Free, Basic or Standard. A service level may be agreed in writing on the Advanced plan." },
      { n: "9.2", v: "We may make planned maintenance outside Central European business hours and will give notice where it is likely to interrupt the service." },
      { n: "9.3", v: "We develop the service continuously. We will not remove a material function that your plan includes without ninety days' notice, and we will not narrow the four states, the provenance record or the coverage links at all." },
      { n: "9.4", v: "Rulesets change as the law changes. We maintain them at the depth we publish for each jurisdiction, and monitoring will tell you which of your products a material change affects. Editorial corrections do not generate notifications." },
    ]),
    sec("10", "Liability", "This section is drafted to be read, and it is the section most in need of review by counsel and by an insurer.", [
      { n: "10.1", v: "The service is provided as described in these terms. We do not warrant that a result is exhaustive, that a jurisdiction is fully encoded beyond the depth published for it, or that a product assessed as clear will be accepted by an authority." },
      { n: "10.2", v: "We are liable for direct loss caused by our breach of this agreement or by our negligence, up to an aggregate amount equal to the fees you paid us in the twelve months before the event giving rise to the claim." },
      { n: "10.3", v: "We are not liable for indirect or consequential loss, including lost profit, lost sales, the cost of reprinting artwork, the cost of a product recall, a delisting, a regulatory penalty, or a missed launch, except where such loss is caused by our gross negligence or wilful misconduct." },
      { n: "10.4", v: "Nothing in this agreement limits liability that cannot be limited under Swedish law, including liability for personal injury and for wilful misconduct." },
      { n: "10.5", v: "A claim under this agreement must be brought within twelve months of the date on which you became aware, or ought reasonably to have become aware, of the circumstances giving rise to it." },
      { n: "10.6", v: "Neither party is liable for a failure to perform caused by an event beyond its reasonable control, provided it notifies the other and resumes performance as soon as it is able." },
    ]),
    sec("11", "Confidentiality", null, [
      { n: "11.1", v: "Each party will keep the other's confidential information in confidence and use it only for the purposes of this agreement. Your product records, formulations, artwork and results are your confidential information." },
      { n: "11.2", v: "Confidentiality does not apply to information that is public, that a party already held without obligation, or that a party is required to disclose by law or by a competent authority. Where we are required to disclose, we will tell you first unless we are prohibited from doing so." },
      { n: "11.3", v: "These obligations continue for three years after the agreement ends, and indefinitely for anything that constitutes a trade secret under the Swedish Trade Secrets Act." },
    ]),
    sec("12", "Ending the agreement", null, [
      { n: "12.1", v: "Either party may terminate for material breach that the other has not remedied within thirty days of written notice." },
      { n: "12.2", v: "On termination your workspace becomes dormant rather than being deleted. You may export everything before termination and for thirty days afterwards." },
      { n: "12.3", v: "Sections 3, 5, 8, 10 and 11 survive termination, as does our obligation to keep answering the verification page for documents already shared." },
    ]),
    sec("13", "Law, disputes and notices", null, [
      { n: "13.1", v: "This agreement is governed by Swedish law, excluding its conflict of laws rules and excluding the United Nations Convention on Contracts for the International Sale of Goods." },
      { n: "13.2", v: "Disputes are to be settled by the Stockholm District Court as court of first instance. Either party may instead apply for arbitration under the Rules for Expedited Arbitrations of the Arbitration Institute of the Stockholm Chamber of Commerce where the amount in dispute is below one million Swedish kronor." },
      { n: "13.3", v: "Notices under this agreement are given in writing to the addresses in the billing details and to finance@nutrivo.ai. Notice of a change to these terms may be given in the service and by email to the administrators of your workspace." },
      { n: "13.4", v: "We may change these terms with sixty days' notice. If a change is materially to your disadvantage you may terminate without penalty before it takes effect, and we will refund the unused part of any prepaid term." },
      { n: "13.5", v: "Neither party may assign this agreement without the other's consent, except that either may assign it to a successor of its business." },
    ]),
  ],
};
