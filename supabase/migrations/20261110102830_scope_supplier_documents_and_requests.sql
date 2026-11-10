-- Supplier documents and document requests follow product scope (DB-5 follow-up to #179).
-- Until now app.supplier_documents and app.document_requests were read with read_member (private.is_member), so a
-- family-scoped member read the rows, and since T-802 the editor's request title, of products outside their scope,
-- although the files themselves were already scoped by private.can_read_object. The rows now follow the same rule as
-- the files (docs/04-contracts.md, Storage): a row with a product is readable by a member who sees that product
-- (private.can_see_product); a row without a product is workspace-wide and readable by every member (as T-802's
-- request_document already assumes). The membership test stays in front of both branches, so a row is never read
-- outside its own workspace even if its product belonged to another. app.suppliers carries no product and keeps
-- read_member. Grants are unchanged (select to authenticated, nothing to anon, no client writes).
drop policy read_member on app.supplier_documents;
drop policy read_member on app.document_requests;

create policy read_scoped on app.supplier_documents for select to authenticated
  using (private.is_member(workspace_id)
         and ((product_id is null) or (product_id is not null and private.can_see_product(product_id))));
create policy read_scoped on app.document_requests for select to authenticated
  using (private.is_member(workspace_id)
         and ((product_id is null) or (product_id is not null and private.can_see_product(product_id))));
