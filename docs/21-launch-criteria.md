# 21 · Launch criteria

Nutrivo is ready for paying customers when every line below is true, and the founders sign gate G9 on the launch
issue (T-1107).

1. **Conformance.**
   - Every required acceptance ID passes in the nightly staging run for 7 consecutive nights.
   - No acceptance test is in quarantine.
2. **Frontend.**
   - Every screen in spec/screens.yaml is built and within its visual threshold.
   - The no-dead-controls crawl is clean.
   - axe reports zero serious or critical findings.
3. **Performance.** Every budget in spec/nfr.yaml is met in the staging load test.
4. **Reliability.**
   - Synthetic monitoring has been green for 7 days and every Sentry cron monitor is configured.
   - The error budget is healthy.
   - A restore drill has been done.
5. **Observability.**
   - The production doctor is green.
   - Sentry and Langfuse are receiving production data.
   - Alerts reach named people.
6. **Security.**
   - The rls-reviewer sweep says APPROVE and Supabase advisors are clean.
   - There are no high or critical vulnerabilities and the secrets scan is clean.
   - The pentest is done or booked before the first paid contract.
7. **Content.**
   - The launch ruleset is released and reviewed by an independent feed-law expert.
   - The public coverage page shows exactly the released coverage.
8. **Legal.** Terms, DPA and privacy policy are reviewed by counsel, and the sub-processor list matches what is
   deployed.
9. **Billing.**
   - Stripe live mode is proven with a real card and a refund.
   - Reverse charge and Swedish VAT invoices are verified.
10. **Data honesty.** No public page or report shows a number the system did not compute.
