
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "app": {
          Tables: {
            "alert_reads": {
                  Row: {
                    "alert_id": string,"person_id": string,"read_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "alert_id": string,"person_id": string,"read_at"?: string
                  }
                  Update: {
                    "alert_id"?: string,"person_id"?: string,"read_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "alert_reads_alert_id_fkey"
      columns: ["alert_id"]
isOneToOne: false
      referencedRelation: "alerts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "alert_reads_person_id_fkey"
      columns: ["person_id"]
isOneToOne: false
      referencedRelation: "people"
      referencedColumns: ["id"]
    }
                  ]
                },"alerts": {
                  Row: {
                    "created_at": string,"effect_type": string,"effective_from": string | null,"id": string,"node_id": string,"phase": string,"product_id": string,"rule_diff_id": string,"sell_through_until": string | null,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"effect_type": string,"effective_from"?: string | null,"id"?: string,"node_id": string,"phase": string,"product_id": string,"rule_diff_id": string,"sell_through_until"?: string | null,"workspace_id": string
                  }
                  Update: {
                    "created_at"?: string,"effect_type"?: string,"effective_from"?: string | null,"id"?: string,"node_id"?: string,"phase"?: string,"product_id"?: string,"rule_diff_id"?: string,"sell_through_until"?: string | null,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "alerts_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "alerts_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"allowance_consumptions": {
                  Row: {
                    "artwork_version_id": string,"consumed_at": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "artwork_version_id": string,"consumed_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "artwork_version_id"?: string,"consumed_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "allowance_consumptions_artwork_version_id_fkey"
      columns: ["artwork_version_id"]
isOneToOne: true
      referencedRelation: "artwork_versions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "allowance_consumptions_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"allowances": {
                  Row: {
                    "labels_allowed": number,"labels_used": number,"updated_at": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "labels_allowed"?: number,"labels_used"?: number,"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "labels_allowed"?: number,"labels_used"?: number,"updated_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "allowances_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: true
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"artwork_panels": {
                  Row: {
                    "artwork_version_id": string,"bbox_mm": (number)[],"created_at": string,"extraction_run_id": string,"failure_code": string | null,"id": string,"language": string | null,"language_confidence": number | null,"page": number,"panel_index": number,"product_id": string,"status": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "artwork_version_id": string,"bbox_mm": (number)[],"created_at"?: string,"extraction_run_id": string,"failure_code"?: string | null,"id"?: string,"language"?: string | null,"language_confidence"?: number | null,"page": number,"panel_index": number,"product_id": string,"status": string,"workspace_id": string
                  }
                  Update: {
                    "artwork_version_id"?: string,"bbox_mm"?: (number)[],"created_at"?: string,"extraction_run_id"?: string,"failure_code"?: string | null,"id"?: string,"language"?: string | null,"language_confidence"?: number | null,"page"?: number,"panel_index"?: number,"product_id"?: string,"status"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "artwork_panels_artwork_version_id_fkey"
      columns: ["artwork_version_id"]
isOneToOne: false
      referencedRelation: "artwork_versions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "artwork_panels_extraction_run_id_fkey"
      columns: ["extraction_run_id"]
isOneToOne: false
      referencedRelation: "extraction_runs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "artwork_panels_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "artwork_panels_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"artwork_versions": {
                  Row: {
                    "created_at": string,"file_name": string | null,"file_sha256": string,"id": string,"is_new_artwork": boolean,"mime_type": string | null,"page_count": number | null,"page_size_mm": (number)[] | null,"product_id": string,"storage_path": string,"uploaded_by": string | null,"version": number,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"file_name"?: string | null,"file_sha256": string,"id"?: string,"is_new_artwork": boolean,"mime_type"?: string | null,"page_count"?: number | null,"page_size_mm"?: (number)[] | null,"product_id": string,"storage_path": string,"uploaded_by"?: string | null,"version": number,"workspace_id": string
                  }
                  Update: {
                    "created_at"?: string,"file_name"?: string | null,"file_sha256"?: string,"id"?: string,"is_new_artwork"?: boolean,"mime_type"?: string | null,"page_count"?: number | null,"page_size_mm"?: (number)[] | null,"product_id"?: string,"storage_path"?: string,"uploaded_by"?: string | null,"version"?: number,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "artwork_versions_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "artwork_versions_uploaded_by_fkey"
      columns: ["uploaded_by"]
isOneToOne: false
      referencedRelation: "people"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "artwork_versions_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"audit_events": {
                  Row: {
                    "actor_id": string | null,"actor_is_external": boolean,"after": Json | null,"at": string,"before": Json | null,"id": number,"kind": string,"object_id": string | null,"object_type": string | null,"ruleset_version": string | null,"workspace_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "actor_id"?: string | null,"actor_is_external"?: boolean,"after"?: Json | null,"at"?: string,"before"?: Json | null,"id"?: never,"kind": string,"object_id"?: string | null,"object_type"?: string | null,"ruleset_version"?: string | null,"workspace_id"?: string | null
                  }
                  Update: {
                    "actor_id"?: string | null,"actor_is_external"?: boolean,"after"?: Json | null,"at"?: string,"before"?: Json | null,"id"?: never,"kind"?: string,"object_id"?: string | null,"object_type"?: string | null,"ruleset_version"?: string | null,"workspace_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "audit_events_actor_id_fkey"
      columns: ["actor_id"]
isOneToOne: false
      referencedRelation: "people"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "audit_events_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"billing_details": {
                  Row: {
                    "address": Json | null,"legal_name": string | null,"updated_at": string,"vat_number": string | null,"vat_validated_at": string | null,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "address"?: Json | null,"legal_name"?: string | null,"updated_at"?: string,"vat_number"?: string | null,"vat_validated_at"?: string | null,"workspace_id": string
                  }
                  Update: {
                    "address"?: Json | null,"legal_name"?: string | null,"updated_at"?: string,"vat_number"?: string | null,"vat_validated_at"?: string | null,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "billing_details_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: true
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"certificates": {
                  Row: {
                    "grant_id": string,"hash": string,"id": string,"node_id": string,"prev_hash": string | null,"product_id": string,"report_id": string,"signed_at": string,"signer_id": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "grant_id": string,"hash": string,"id"?: string,"node_id": string,"prev_hash"?: string | null,"product_id": string,"report_id": string,"signed_at"?: string,"signer_id": string,"workspace_id": string
                  }
                  Update: {
                    "grant_id"?: string,"hash"?: string,"id"?: string,"node_id"?: string,"prev_hash"?: string | null,"product_id"?: string,"report_id"?: string,"signed_at"?: string,"signer_id"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "certificates_grant_id_fkey"
      columns: ["grant_id"]
isOneToOne: false
      referencedRelation: "signing_grants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "certificates_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "certificates_report_id_fkey"
      columns: ["report_id"]
isOneToOne: false
      referencedRelation: "reports"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "certificates_signer_id_fkey"
      columns: ["signer_id"]
isOneToOne: false
      referencedRelation: "people"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "certificates_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"check_findings": {
                  Row: {
                    "bbox_mm": (number)[] | null,"check_id": string,"citation": string | null,"confidence": number | null,"created_at": string,"gap_id": string | null,"height_definition": string | null,"id": string,"kind": string,"language": string | null,"measured_mm": number | null,"message": string,"model_call_id": string | null,"node_id": string,"panel_id": string | null,"product_id": string,"provenance": string,"reason_code": string | null,"recommended_action": string | null,"required_mm": number | null,"rule_key": string | null,"rule_version": number | null,"state": string,"text_object_id": string | null,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "bbox_mm"?: (number)[] | null,"check_id": string,"citation"?: string | null,"confidence"?: number | null,"created_at"?: string,"gap_id"?: string | null,"height_definition"?: string | null,"id"?: string,"kind"?: string,"language"?: string | null,"measured_mm"?: number | null,"message": string,"model_call_id"?: string | null,"node_id": string,"panel_id"?: string | null,"product_id": string,"provenance": string,"reason_code"?: string | null,"recommended_action"?: string | null,"required_mm"?: number | null,"rule_key"?: string | null,"rule_version"?: number | null,"state": string,"text_object_id"?: string | null,"workspace_id": string
                  }
                  Update: {
                    "bbox_mm"?: (number)[] | null,"check_id"?: string,"citation"?: string | null,"confidence"?: number | null,"created_at"?: string,"gap_id"?: string | null,"height_definition"?: string | null,"id"?: string,"kind"?: string,"language"?: string | null,"measured_mm"?: number | null,"message"?: string,"model_call_id"?: string | null,"node_id"?: string,"panel_id"?: string | null,"product_id"?: string,"provenance"?: string,"reason_code"?: string | null,"recommended_action"?: string | null,"required_mm"?: number | null,"rule_key"?: string | null,"rule_version"?: number | null,"state"?: string,"text_object_id"?: string | null,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "check_findings_check_id_fkey"
      columns: ["check_id"]
isOneToOne: false
      referencedRelation: "checks"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "check_findings_panel_id_fkey"
      columns: ["panel_id"]
isOneToOne: false
      referencedRelation: "artwork_panels"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "check_findings_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "check_findings_text_object_id_fkey"
      columns: ["text_object_id"]
isOneToOne: false
      referencedRelation: "text_objects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "check_findings_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"checks": {
                  Row: {
                    "actor_id": string | null,"actor_is_external": boolean,"applied_rule_keys": (string)[],"artwork_sha": string | null,"artwork_version_id": string | null,"at": string,"classification_id": string | null,"id": string,"job_id": string | null,"label_state": string,"language": string | null,"node_id": string,"panel_id": string | null,"passed_rule_keys": (string)[],"product_id": string,"ruleset_version": string,"trigger": string,"withheld_rule_keys": (string)[],"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "actor_id"?: string | null,"actor_is_external"?: boolean,"applied_rule_keys"?: (string)[],"artwork_sha"?: string | null,"artwork_version_id"?: string | null,"at"?: string,"classification_id"?: string | null,"id"?: string,"job_id"?: string | null,"label_state": string,"language"?: string | null,"node_id": string,"panel_id"?: string | null,"passed_rule_keys"?: (string)[],"product_id": string,"ruleset_version": string,"trigger"?: string,"withheld_rule_keys"?: (string)[],"workspace_id": string
                  }
                  Update: {
                    "actor_id"?: string | null,"actor_is_external"?: boolean,"applied_rule_keys"?: (string)[],"artwork_sha"?: string | null,"artwork_version_id"?: string | null,"at"?: string,"classification_id"?: string | null,"id"?: string,"job_id"?: string | null,"label_state"?: string,"language"?: string | null,"node_id"?: string,"panel_id"?: string | null,"passed_rule_keys"?: (string)[],"product_id"?: string,"ruleset_version"?: string,"trigger"?: string,"withheld_rule_keys"?: (string)[],"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "checks_actor_id_fkey"
      columns: ["actor_id"]
isOneToOne: false
      referencedRelation: "people"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "checks_artwork_version_id_fkey"
      columns: ["artwork_version_id"]
isOneToOne: false
      referencedRelation: "artwork_versions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "checks_classification_id_fkey"
      columns: ["classification_id"]
isOneToOne: false
      referencedRelation: "classifications"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "checks_job_id_fkey"
      columns: ["job_id"]
isOneToOne: false
      referencedRelation: "jobs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "checks_panel_id_fkey"
      columns: ["panel_id"]
isOneToOne: false
      referencedRelation: "artwork_panels"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "checks_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "checks_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"classifications": {
                  Row: {
                    "citation": string,"confirmed_at": string | null,"confirmed_by": string | null,"created_at": string,"id": string,"intended_use": string | null,"life_stage": string | null,"model_call_id": string | null,"parnut_status": string | null,"product_class": string | null,"product_id": string,"provenance": string,"species": string | null,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "citation": string,"confirmed_at"?: string | null,"confirmed_by"?: string | null,"created_at"?: string,"id"?: string,"intended_use"?: string | null,"life_stage"?: string | null,"model_call_id"?: string | null,"parnut_status"?: string | null,"product_class"?: string | null,"product_id": string,"provenance": string,"species"?: string | null,"workspace_id": string
                  }
                  Update: {
                    "citation"?: string,"confirmed_at"?: string | null,"confirmed_by"?: string | null,"created_at"?: string,"id"?: string,"intended_use"?: string | null,"life_stage"?: string | null,"model_call_id"?: string | null,"parnut_status"?: string | null,"product_class"?: string | null,"product_id"?: string,"provenance"?: string,"species"?: string | null,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "classifications_confirmed_by_fkey"
      columns: ["confirmed_by"]
isOneToOne: false
      referencedRelation: "people"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "classifications_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "classifications_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"document_requests": {
                  Row: {
                    "created_at": string,"created_by": string | null,"doc_type": string,"expires_at": string,"fulfilled_at": string | null,"id": string,"product_id": string | null,"supplier_id": string,"token_hash": string | null,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"doc_type": string,"expires_at"?: string,"fulfilled_at"?: string | null,"id"?: string,"product_id"?: string | null,"supplier_id": string,"token_hash"?: string | null,"workspace_id": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"doc_type"?: string,"expires_at"?: string,"fulfilled_at"?: string | null,"id"?: string,"product_id"?: string | null,"supplier_id"?: string,"token_hash"?: string | null,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "document_requests_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "people"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "document_requests_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "document_requests_supplier_id_fkey"
      columns: ["supplier_id"]
isOneToOne: false
      referencedRelation: "suppliers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "document_requests_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"envelope_items": {
                  Row: {
                    "envelope_id": string,"gap_id": string | null,"id": string,"kind": string,"payload": NonNullable<Json>,"product_id": string,"provenance": string,"rule_key": string | null,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "envelope_id": string,"gap_id"?: string | null,"id"?: string,"kind": string,"payload"?: NonNullable<Json>,"product_id": string,"provenance": string,"rule_key"?: string | null,"workspace_id": string
                  }
                  Update: {
                    "envelope_id"?: string,"gap_id"?: string | null,"id"?: string,"kind"?: string,"payload"?: NonNullable<Json>,"product_id"?: string,"provenance"?: string,"rule_key"?: string | null,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "envelope_items_envelope_id_fkey"
      columns: ["envelope_id"]
isOneToOne: false
      referencedRelation: "envelopes"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "envelope_items_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "envelope_items_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"envelopes": {
                  Row: {
                    "created_at": string,"id": string,"inputs_hash": string,"product_id": string,"ruleset_version": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"inputs_hash": string,"product_id": string,"ruleset_version": string,"workspace_id": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"inputs_hash"?: string,"product_id"?: string,"ruleset_version"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "envelopes_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "envelopes_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"extraction_runs": {
                  Row: {
                    "artwork_version_id": string,"created_at": string,"engine": string,"engine_version": string,"failure_codes": (string)[],"finished_at": string | null,"id": string,"idempotency_key": string,"product_id": string,"started_at": string | null,"status": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "artwork_version_id": string,"created_at"?: string,"engine": string,"engine_version": string,"failure_codes"?: (string)[],"finished_at"?: string | null,"id"?: string,"idempotency_key": string,"product_id": string,"started_at"?: string | null,"status"?: string,"workspace_id": string
                  }
                  Update: {
                    "artwork_version_id"?: string,"created_at"?: string,"engine"?: string,"engine_version"?: string,"failure_codes"?: (string)[],"finished_at"?: string | null,"id"?: string,"idempotency_key"?: string,"product_id"?: string,"started_at"?: string | null,"status"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "extraction_runs_artwork_version_id_fkey"
      columns: ["artwork_version_id"]
isOneToOne: false
      referencedRelation: "artwork_versions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "extraction_runs_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "extraction_runs_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"families": {
                  Row: {
                    "created_at": string,"discontinued_at": string | null,"id": string,"name": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"discontinued_at"?: string | null,"id"?: string,"name": string,"workspace_id": string
                  }
                  Update: {
                    "created_at"?: string,"discontinued_at"?: string | null,"id"?: string,"name"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "families_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"formula_lines": {
                  Row: {
                    "additive_ref": string | null,"amount": number | null,"applied_by": string | null,"created_at": string,"feed_material_ref": string | null,"id": string,"ingredient": string,"percent": number | null,"position": number,"product_id": string,"unit": string | null,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "additive_ref"?: string | null,"amount"?: number | null,"applied_by"?: string | null,"created_at"?: string,"feed_material_ref"?: string | null,"id"?: string,"ingredient": string,"percent"?: number | null,"position": number,"product_id": string,"unit"?: string | null,"workspace_id": string
                  }
                  Update: {
                    "additive_ref"?: string | null,"amount"?: number | null,"applied_by"?: string | null,"created_at"?: string,"feed_material_ref"?: string | null,"id"?: string,"ingredient"?: string,"percent"?: number | null,"position"?: number,"product_id"?: string,"unit"?: string | null,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "formula_lines_applied_by_fkey"
      columns: ["applied_by"]
isOneToOne: false
      referencedRelation: "people"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "formula_lines_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "formula_lines_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"intended_claims": {
                  Row: {
                    "claim_text": string,"created_at": string,"id": string,"language": string,"product_id": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "claim_text": string,"created_at"?: string,"id"?: string,"language": string,"product_id": string,"workspace_id": string
                  }
                  Update: {
                    "claim_text"?: string,"created_at"?: string,"id"?: string,"language"?: string,"product_id"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "intended_claims_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "intended_claims_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"invitations": {
                  Row: {
                    "accepted_at": string | null,"access_ends_at": string | null,"created_at": string,"email": string,"expires_at": string,"id": string,"invited_by": string,"is_external": boolean,"revoked_at": string | null,"role": string,"scope_family_ids": (string)[] | null,"scope_node_ids": (string)[] | null,"token_hash": string | null,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "accepted_at"?: string | null,"access_ends_at"?: string | null,"created_at"?: string,"email": string,"expires_at"?: string,"id"?: string,"invited_by": string,"is_external"?: boolean,"revoked_at"?: string | null,"role": string,"scope_family_ids"?: (string)[] | null,"scope_node_ids"?: (string)[] | null,"token_hash"?: string | null,"workspace_id": string
                  }
                  Update: {
                    "accepted_at"?: string | null,"access_ends_at"?: string | null,"created_at"?: string,"email"?: string,"expires_at"?: string,"id"?: string,"invited_by"?: string,"is_external"?: boolean,"revoked_at"?: string | null,"role"?: string,"scope_family_ids"?: (string)[] | null,"scope_node_ids"?: (string)[] | null,"token_hash"?: string | null,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "invitations_invited_by_fkey"
      columns: ["invited_by"]
isOneToOne: false
      referencedRelation: "people"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "invitations_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"jobs": {
                  Row: {
                    "attempts": number,"created_at": string,"id": string,"idempotency_key": string,"kind": string,"last_error": string | null,"payload": NonNullable<Json>,"progress": NonNullable<Json>,"requested_by": string | null,"status": string,"updated_at": string,"workspace_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "attempts"?: number,"created_at"?: string,"id"?: string,"idempotency_key": string,"kind": string,"last_error"?: string | null,"payload"?: NonNullable<Json>,"progress"?: NonNullable<Json>,"requested_by"?: string | null,"status"?: string,"updated_at"?: string,"workspace_id"?: string | null
                  }
                  Update: {
                    "attempts"?: number,"created_at"?: string,"id"?: string,"idempotency_key"?: string,"kind"?: string,"last_error"?: string | null,"payload"?: NonNullable<Json>,"progress"?: NonNullable<Json>,"requested_by"?: string | null,"status"?: string,"updated_at"?: string,"workspace_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "jobs_requested_by_fkey"
      columns: ["requested_by"]
isOneToOne: false
      referencedRelation: "people"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "jobs_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"memberships": {
                  Row: {
                    "access_ends_at": string | null,"created_at": string,"ended_at": string | null,"ended_reason": string | null,"id": string,"is_external": boolean,"person_id": string,"role": string,"scope_family_ids": (string)[] | null,"scope_node_ids": (string)[] | null,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "access_ends_at"?: string | null,"created_at"?: string,"ended_at"?: string | null,"ended_reason"?: string | null,"id"?: string,"is_external"?: boolean,"person_id": string,"role": string,"scope_family_ids"?: (string)[] | null,"scope_node_ids"?: (string)[] | null,"workspace_id": string
                  }
                  Update: {
                    "access_ends_at"?: string | null,"created_at"?: string,"ended_at"?: string | null,"ended_reason"?: string | null,"id"?: string,"is_external"?: boolean,"person_id"?: string,"role"?: string,"scope_family_ids"?: (string)[] | null,"scope_node_ids"?: (string)[] | null,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "memberships_person_id_fkey"
      columns: ["person_id"]
isOneToOne: false
      referencedRelation: "people"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "memberships_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"model_calls": {
                  Row: {
                    "cost_eur": number | null,"created_at": string,"id": string,"input_hash": string,"input_tokens": number | null,"latency_ms": number | null,"model_id": string,"output": Json | null,"output_tokens": number | null,"prompt_version": string,"provider": string,"purpose": string,"workspace_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "cost_eur"?: number | null,"created_at"?: string,"id"?: string,"input_hash": string,"input_tokens"?: number | null,"latency_ms"?: number | null,"model_id": string,"output"?: Json | null,"output_tokens"?: number | null,"prompt_version": string,"provider": string,"purpose": string,"workspace_id"?: string | null
                  }
                  Update: {
                    "cost_eur"?: number | null,"created_at"?: string,"id"?: string,"input_hash"?: string,"input_tokens"?: number | null,"latency_ms"?: number | null,"model_id"?: string,"output"?: Json | null,"output_tokens"?: number | null,"prompt_version"?: string,"provider"?: string,"purpose"?: string,"workspace_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "model_calls_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"notification_prefs": {
                  Row: {
                    "channel": string,"enabled": boolean,"kind": string,"person_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "channel": string,"enabled"?: boolean,"kind": string,"person_id": string
                  }
                  Update: {
                    "channel"?: string,"enabled"?: boolean,"kind"?: string,"person_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "notification_prefs_person_id_fkey"
      columns: ["person_id"]
isOneToOne: false
      referencedRelation: "people"
      referencedColumns: ["id"]
    }
                  ]
                },"notifications": {
                  Row: {
                    "created_at": string,"id": string,"kind": string,"object_ref": NonNullable<Json>,"person_id": string,"read_at": string | null,"severity": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"kind": string,"object_ref"?: NonNullable<Json>,"person_id": string,"read_at"?: string | null,"severity"?: string,"workspace_id": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"kind"?: string,"object_ref"?: NonNullable<Json>,"person_id"?: string,"read_at"?: string | null,"severity"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "notifications_person_id_fkey"
      columns: ["person_id"]
isOneToOne: false
      referencedRelation: "people"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "notifications_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"payment_events": {
                  Row: {
                    "payload": NonNullable<Json>,"received_at": string,"stripe_event_id": string,"type": string,"workspace_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "payload": NonNullable<Json>,"received_at"?: string,"stripe_event_id": string,"type": string,"workspace_id"?: string | null
                  }
                  Update: {
                    "payload"?: NonNullable<Json>,"received_at"?: string,"stripe_event_id"?: string,"type"?: string,"workspace_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "payment_events_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"people": {
                  Row: {
                    "created_at": string,"display_name": string,"email": string | null,"id": string,"tombstoned_at": string | null,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"display_name": string,"email"?: string | null,"id"?: string,"tombstoned_at"?: string | null,"user_id"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"display_name"?: string,"email"?: string | null,"id"?: string,"tombstoned_at"?: string | null,"user_id"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"product_nodes": {
                  Row: {
                    "display_state": string | null,"label_state": string,"last_check_job_id": string | null,"node_id": string,"open_actions": number,"product_id": string,"registration_state": string,"ruleset_version": string | null,"updated_at": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "display_state"?: never,"label_state"?: string,"last_check_job_id"?: string | null,"node_id": string,"open_actions"?: number,"product_id": string,"registration_state"?: string,"ruleset_version"?: string | null,"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "display_state"?: never,"label_state"?: string,"last_check_job_id"?: string | null,"node_id"?: string,"open_actions"?: number,"product_id"?: string,"registration_state"?: string,"ruleset_version"?: string | null,"updated_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "product_nodes_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_nodes_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"products": {
                  Row: {
                    "created_at": string,"discontinued_at": string | null,"family_id": string,"format": string | null,"id": string,"life_stage": string | null,"name": string,"operator": Json | null,"species": string | null,"stage": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"discontinued_at"?: string | null,"family_id": string,"format"?: string | null,"id"?: string,"life_stage"?: string | null,"name": string,"operator"?: Json | null,"species"?: string | null,"stage"?: string,"workspace_id": string
                  }
                  Update: {
                    "created_at"?: string,"discontinued_at"?: string | null,"family_id"?: string,"format"?: string | null,"id"?: string,"life_stage"?: string | null,"name"?: string,"operator"?: Json | null,"species"?: string | null,"stage"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "products_family_id_fkey"
      columns: ["family_id"]
isOneToOne: false
      referencedRelation: "families"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "products_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"registration_packs": {
                  Row: {
                    "created_at": string,"evidence_state": NonNullable<Json>,"id": string,"node_id": string,"obligation_id": string | null,"product_id": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"evidence_state"?: NonNullable<Json>,"id"?: string,"node_id": string,"obligation_id"?: string | null,"product_id": string,"workspace_id": string
                  }
                  Update: {
                    "created_at"?: string,"evidence_state"?: NonNullable<Json>,"id"?: string,"node_id"?: string,"obligation_id"?: string | null,"product_id"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "registration_packs_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "registration_packs_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"registrations": {
                  Row: {
                    "created_at": string,"evidence_doc_id": string | null,"expires_at": string | null,"id": string,"node_id": string,"number": string | null,"obligation_id": string | null,"product_id": string,"recorded_by": string | null,"registered_on": string | null,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"evidence_doc_id"?: string | null,"expires_at"?: string | null,"id"?: string,"node_id": string,"number"?: string | null,"obligation_id"?: string | null,"product_id": string,"recorded_by"?: string | null,"registered_on"?: string | null,"workspace_id": string
                  }
                  Update: {
                    "created_at"?: string,"evidence_doc_id"?: string | null,"expires_at"?: string | null,"id"?: string,"node_id"?: string,"number"?: string | null,"obligation_id"?: string | null,"product_id"?: string,"recorded_by"?: string | null,"registered_on"?: string | null,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "registrations_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "registrations_recorded_by_fkey"
      columns: ["recorded_by"]
isOneToOne: false
      referencedRelation: "people"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "registrations_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"reports": {
                  Row: {
                    "artwork_sha": string,"check_ids": (string)[],"created_at": string,"created_by": string | null,"has_not_assessed": boolean,"id": string,"job_id": string | null,"node_id": string | null,"pdf_path": string | null,"pdf_sha256": string | null,"product_id": string,"ref": string,"ruleset_version": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "artwork_sha": string,"check_ids": (string)[],"created_at"?: string,"created_by"?: string | null,"has_not_assessed": boolean,"id"?: string,"job_id"?: string | null,"node_id"?: string | null,"pdf_path"?: string | null,"pdf_sha256"?: string | null,"product_id": string,"ref": string,"ruleset_version": string,"workspace_id": string
                  }
                  Update: {
                    "artwork_sha"?: string,"check_ids"?: (string)[],"created_at"?: string,"created_by"?: string | null,"has_not_assessed"?: boolean,"id"?: string,"job_id"?: string | null,"node_id"?: string | null,"pdf_path"?: string | null,"pdf_sha256"?: string | null,"product_id"?: string,"ref"?: string,"ruleset_version"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "reports_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "people"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "reports_job_id_fkey"
      columns: ["job_id"]
isOneToOne: false
      referencedRelation: "jobs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "reports_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "reports_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"saved_views": {
                  Row: {
                    "columns": NonNullable<Json>,"created_at": string,"created_by": string | null,"filters": NonNullable<Json>,"id": string,"name": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "columns"?: NonNullable<Json>,"created_at"?: string,"created_by"?: string | null,"filters"?: NonNullable<Json>,"id"?: string,"name": string,"workspace_id": string
                  }
                  Update: {
                    "columns"?: NonNullable<Json>,"created_at"?: string,"created_by"?: string | null,"filters"?: NonNullable<Json>,"id"?: string,"name"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "saved_views_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "people"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "saved_views_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"share_access_log": {
                  Row: {
                    "accessed_at": string,"id": number,"ip_hash": string | null,"share_id": string,"user_agent": string | null,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "accessed_at"?: string,"id"?: never,"ip_hash"?: string | null,"share_id": string,"user_agent"?: string | null,"workspace_id": string
                  }
                  Update: {
                    "accessed_at"?: string,"id"?: never,"ip_hash"?: string | null,"share_id"?: string,"user_agent"?: string | null,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "share_access_log_share_id_fkey"
      columns: ["share_id"]
isOneToOne: false
      referencedRelation: "shares"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "share_access_log_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"shares": {
                  Row: {
                    "channel": string,"created_at": string,"created_by": string | null,"expires_at": string | null,"id": string,"recipient": string | null,"report_id": string,"revoked_at": string | null,"token_hash": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "channel": string,"created_at"?: string,"created_by"?: string | null,"expires_at"?: string | null,"id"?: string,"recipient"?: string | null,"report_id": string,"revoked_at"?: string | null,"token_hash": string,"workspace_id": string
                  }
                  Update: {
                    "channel"?: string,"created_at"?: string,"created_by"?: string | null,"expires_at"?: string | null,"id"?: string,"recipient"?: string | null,"report_id"?: string,"revoked_at"?: string | null,"token_hash"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "shares_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "people"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "shares_report_id_fkey"
      columns: ["report_id"]
isOneToOne: false
      referencedRelation: "reports"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "shares_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"signing_grants": {
                  Row: {
                    "granted_at": string,"granted_by": string,"id": string,"node_id": string,"person_id": string,"revoked_at": string | null,"revoked_by": string | null,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "granted_at"?: string,"granted_by": string,"id"?: string,"node_id": string,"person_id": string,"revoked_at"?: string | null,"revoked_by"?: string | null,"workspace_id": string
                  }
                  Update: {
                    "granted_at"?: string,"granted_by"?: string,"id"?: string,"node_id"?: string,"person_id"?: string,"revoked_at"?: string | null,"revoked_by"?: string | null,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "signing_grants_granted_by_fkey"
      columns: ["granted_by"]
isOneToOne: false
      referencedRelation: "people"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "signing_grants_person_id_fkey"
      columns: ["person_id"]
isOneToOne: false
      referencedRelation: "people"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "signing_grants_revoked_by_fkey"
      columns: ["revoked_by"]
isOneToOne: false
      referencedRelation: "people"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "signing_grants_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"subscriptions": {
                  Row: {
                    "current_period_end": string | null,"editor_seats": number | null,"plan": string,"recipes_included": number | null,"regions": (string)[],"status": string,"stripe_customer_id": string | null,"stripe_subscription_id": string | null,"term": string | null,"updated_at": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "current_period_end"?: string | null,"editor_seats"?: number | null,"plan": string,"recipes_included"?: number | null,"regions"?: (string)[],"status": string,"stripe_customer_id"?: string | null,"stripe_subscription_id"?: string | null,"term"?: string | null,"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "current_period_end"?: string | null,"editor_seats"?: number | null,"plan"?: string,"recipes_included"?: number | null,"regions"?: (string)[],"status"?: string,"stripe_customer_id"?: string | null,"stripe_subscription_id"?: string | null,"term"?: string | null,"updated_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "subscriptions_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: true
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"supersessions": {
                  Row: {
                    "artefact_id": string,"artefact_type": string,"id": string,"rule_diff_id": string | null,"rule_key": string,"ruleset_version": string,"superseded_at": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "artefact_id": string,"artefact_type": string,"id"?: string,"rule_diff_id"?: string | null,"rule_key": string,"ruleset_version": string,"superseded_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "artefact_id"?: string,"artefact_type"?: string,"id"?: string,"rule_diff_id"?: string | null,"rule_key"?: string,"ruleset_version"?: string,"superseded_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "supersessions_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"supplier_documents": {
                  Row: {
                    "created_at": string,"doc_type": string,"file_sha256": string,"id": string,"product_id": string | null,"scan_status": string,"storage_path": string,"supplier_id": string | null,"uploaded_via": string,"valid_from": string | null,"valid_to": string | null,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"doc_type": string,"file_sha256": string,"id"?: string,"product_id"?: string | null,"scan_status"?: string,"storage_path": string,"supplier_id"?: string | null,"uploaded_via": string,"valid_from"?: string | null,"valid_to"?: string | null,"workspace_id": string
                  }
                  Update: {
                    "created_at"?: string,"doc_type"?: string,"file_sha256"?: string,"id"?: string,"product_id"?: string | null,"scan_status"?: string,"storage_path"?: string,"supplier_id"?: string | null,"uploaded_via"?: string,"valid_from"?: string | null,"valid_to"?: string | null,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "supplier_documents_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "supplier_documents_supplier_id_fkey"
      columns: ["supplier_id"]
isOneToOne: false
      referencedRelation: "suppliers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "supplier_documents_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"suppliers": {
                  Row: {
                    "created_at": string,"email": string | null,"id": string,"name": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"email"?: string | null,"id"?: string,"name": string,"workspace_id": string
                  }
                  Update: {
                    "created_at"?: string,"email"?: string | null,"id"?: string,"name"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "suppliers_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"text_objects": {
                  Row: {
                    "bbox_mm": (number)[],"cap_height_mm": number | null,"confidence": number | null,"font_name": string | null,"font_size_pt": number | null,"id": string,"is_ocr": boolean,"panel_id": string,"product_id": string,"reading_order": number | null,"text": string,"workspace_id": string,"x_height_mm": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "bbox_mm": (number)[],"cap_height_mm"?: number | null,"confidence"?: number | null,"font_name"?: string | null,"font_size_pt"?: number | null,"id"?: string,"is_ocr"?: boolean,"panel_id": string,"product_id": string,"reading_order"?: number | null,"text": string,"workspace_id": string,"x_height_mm"?: number | null
                  }
                  Update: {
                    "bbox_mm"?: (number)[],"cap_height_mm"?: number | null,"confidence"?: number | null,"font_name"?: string | null,"font_size_pt"?: number | null,"id"?: string,"is_ocr"?: boolean,"panel_id"?: string,"product_id"?: string,"reading_order"?: number | null,"text"?: string,"workspace_id"?: string,"x_height_mm"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "text_objects_panel_id_fkey"
      columns: ["panel_id"]
isOneToOne: false
      referencedRelation: "artwork_panels"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "text_objects_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "text_objects_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"workspaces": {
                  Row: {
                    "created_at": string,"created_by": string | null,"default_operator": Json | null,"entitled_regions": (string)[],"id": string,"name": string,"plan": string,"sso_policy": string,"status": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"default_operator"?: Json | null,"entitled_regions"?: (string)[],"id"?: string,"name": string,"plan"?: string,"sso_policy"?: string,"status"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"default_operator"?: Json | null,"entitled_regions"?: (string)[],"id"?: string,"name"?: string,"plan"?: string,"sso_policy"?: string,"status"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "workspaces_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "people"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "accept_invitation":
{ Args: { "p_token": string }; Returns: string
                           },
"affected_objects":
{ Args: { "p_rule_diff": string }; Returns: {
              "node_id": string,"product_id": string,"workspace_id": string
            }[]
                           },
"change_member":
{ Args: { "p_access_ends_at": string,"p_is_external": boolean,"p_membership": string,"p_role": string,"p_scope_family_ids": (string)[],"p_scope_node_ids": (string)[] }; Returns: string
                           },
"create_workspace":
{ Args: { "p_name": string }; Returns: string
                           },
"invite_member":
{ Args: { "p_access_ends_at"?: string,"p_email": string,"p_is_external"?: boolean,"p_role": string,"p_scope_family_ids"?: (string)[],"p_scope_node_ids"?: (string)[],"p_ws": string }; Returns: string
                           },
"issue_certificate":
{ Args: { "p_node": string,"p_report": string }; Returns: string
                           },
"live_billable_counts":
{ Args: { "p_ws": string }; Returns: Json
                           },
"my_ended_access":
{ Args: { "p_ws": string }; Returns: Json
                           },
"register_artwork":
{ Args: { "p_file_name"?: string,"p_mime"?: string,"p_product": string,"p_sha256": string,"p_storage_path": string }; Returns: string
                           },
"remove_member":
{ Args: { "p_membership": string,"p_reason"?: string }; Returns: string
                           },
"request_check":
{ Args: { "p_nodes"?: (string)[],"p_product": string }; Returns: string
                           },
"revoke_invitation":
{ Args: { "p_invitation": string }; Returns: string
                           },
"rollup_state":
{ Args: { "p_node": string,"p_product": string }; Returns: string
                           },
"set_default_operator":
{ Args: { "p_operator": Json,"p_ws": string }; Returns: string
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "coverage_snapshot":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"verify_reference":
{ Args: { "p_ref": string }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"ref": {
          Tables: {
            "coverage_gaps": {
                  Row: {
                    "closed_in": string | null,"description": string,"domain": string,"gap_id": string,"node_id": string,"opened_in": string | null,"reason_code": string
                  }
                  ComputedFields: never
                  Insert: {
                    "closed_in"?: string | null,"description": string,"domain": string,"gap_id": string,"node_id": string,"opened_in"?: string | null,"reason_code": string
                  }
                  Update: {
                    "closed_in"?: string | null,"description"?: string,"domain"?: string,"gap_id"?: string,"node_id"?: string,"opened_in"?: string | null,"reason_code"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "coverage_gaps_closed_in_fkey"
      columns: ["closed_in"]
isOneToOne: false
      referencedRelation: "ruleset_versions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "coverage_gaps_node_id_fkey"
      columns: ["node_id"]
isOneToOne: false
      referencedRelation: "jurisdictions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "coverage_gaps_opened_in_fkey"
      columns: ["opened_in"]
isOneToOne: false
      referencedRelation: "ruleset_versions"
      referencedColumns: ["id"]
    }
                  ]
                },"coverage_nodes": {
                  Row: {
                    "domain": string,"gap_id": string | null,"last_checked_at": string | null,"method": string,"node_id": string,"rules_encoded": number,"ruleset_version": string,"state": string
                  }
                  ComputedFields: never
                  Insert: {
                    "domain": string,"gap_id"?: string | null,"last_checked_at"?: string | null,"method"?: string,"node_id": string,"rules_encoded"?: number,"ruleset_version": string,"state": string
                  }
                  Update: {
                    "domain"?: string,"gap_id"?: string | null,"last_checked_at"?: string | null,"method"?: string,"node_id"?: string,"rules_encoded"?: number,"ruleset_version"?: string,"state"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "coverage_nodes_gap_id_fkey"
      columns: ["gap_id"]
isOneToOne: false
      referencedRelation: "coverage_gaps"
      referencedColumns: ["gap_id"]
    },{
      foreignKeyName: "coverage_nodes_node_id_fkey"
      columns: ["node_id"]
isOneToOne: false
      referencedRelation: "jurisdictions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "coverage_nodes_ruleset_version_fkey"
      columns: ["ruleset_version"]
isOneToOne: false
      referencedRelation: "ruleset_versions"
      referencedColumns: ["id"]
    }
                  ]
                },"document_requirements": {
                  Row: {
                    "doc_type": string,"id": string,"legal_basis": string | null,"node_id": string,"product_class": string,"validity_days": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "doc_type": string,"id"?: string,"legal_basis"?: string | null,"node_id": string,"product_class"?: string,"validity_days"?: number | null
                  }
                  Update: {
                    "doc_type"?: string,"id"?: string,"legal_basis"?: string | null,"node_id"?: string,"product_class"?: string,"validity_days"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "document_requirements_node_id_fkey"
      columns: ["node_id"]
isOneToOne: false
      referencedRelation: "jurisdictions"
      referencedColumns: ["id"]
    }
                  ]
                },"feed_additives": {
                  Row: {
                    "authorising_act": string | null,"category": string | null,"conditions": Json | null,"expiry": string | null,"functional_group": string | null,"id": string,"max_content": Json | null,"name": string,"source_id": string | null,"species": (string)[] | null
                  }
                  ComputedFields: never
                  Insert: {
                    "authorising_act"?: string | null,"category"?: string | null,"conditions"?: Json | null,"expiry"?: string | null,"functional_group"?: string | null,"id": string,"max_content"?: Json | null,"name": string,"source_id"?: string | null,"species"?: (string)[] | null
                  }
                  Update: {
                    "authorising_act"?: string | null,"category"?: string | null,"conditions"?: Json | null,"expiry"?: string | null,"functional_group"?: string | null,"id"?: string,"max_content"?: Json | null,"name"?: string,"source_id"?: string | null,"species"?: (string)[] | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "feed_additives_source_id_fkey"
      columns: ["source_id"]
isOneToOne: false
      referencedRelation: "sources"
      referencedColumns: ["id"]
    }
                  ]
                },"feed_materials": {
                  Row: {
                    "compulsory_declarations": (string)[] | null,"description": string | null,"names": NonNullable<Json>,"number": string,"source_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "compulsory_declarations"?: (string)[] | null,"description"?: string | null,"names": NonNullable<Json>,"number": string,"source_id"?: string | null
                  }
                  Update: {
                    "compulsory_declarations"?: (string)[] | null,"description"?: string | null,"names"?: NonNullable<Json>,"number"?: string,"source_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "feed_materials_source_id_fkey"
      columns: ["source_id"]
isOneToOne: false
      referencedRelation: "sources"
      referencedColumns: ["id"]
    }
                  ]
                },"glossary_entries": {
                  Row: {
                    "definition": string,"key": string,"ruleset_version": string
                  }
                  ComputedFields: never
                  Insert: {
                    "definition": string,"key": string,"ruleset_version": string
                  }
                  Update: {
                    "definition"?: string,"key"?: string,"ruleset_version"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "glossary_entries_ruleset_version_fkey"
      columns: ["ruleset_version"]
isOneToOne: false
      referencedRelation: "ruleset_versions"
      referencedColumns: ["id"]
    }
                  ]
                },"horizon_items": {
                  Row: {
                    "celex": string | null,"created_at": string,"effective_from": string | null,"expected_date": string | null,"id": string,"notes": string | null,"source_id": string | null,"stage": string,"title": string
                  }
                  ComputedFields: never
                  Insert: {
                    "celex"?: string | null,"created_at"?: string,"effective_from"?: string | null,"expected_date"?: string | null,"id"?: string,"notes"?: string | null,"source_id"?: string | null,"stage": string,"title": string
                  }
                  Update: {
                    "celex"?: string | null,"created_at"?: string,"effective_from"?: string | null,"expected_date"?: string | null,"id"?: string,"notes"?: string | null,"source_id"?: string | null,"stage"?: string,"title"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "horizon_items_source_id_fkey"
      columns: ["source_id"]
isOneToOne: false
      referencedRelation: "sources"
      referencedColumns: ["id"]
    }
                  ]
                },"jurisdictions": {
                  Row: {
                    "id": string,"languages": (string)[],"name": string,"node_type": string,"parent_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "id": string,"languages"?: (string)[],"name": string,"node_type": string,"parent_id"?: string | null
                  }
                  Update: {
                    "id"?: string,"languages"?: (string)[],"name"?: string,"node_type"?: string,"parent_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "jurisdictions_parent_id_fkey"
      columns: ["parent_id"]
isOneToOne: false
      referencedRelation: "jurisdictions"
      referencedColumns: ["id"]
    }
                  ]
                },"obligations": {
                  Row: {
                    "authority": string | null,"created_at": string,"evidence_list": Json | null,"fee": string | null,"id": string,"kind": string,"last_verified_at": string | null,"lead_time_days": number | null,"legal_basis": string | null,"node_id": string,"product_class": string,"renewal_cycle": string | null,"route": string | null,"source_url": string | null,"submission_language": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "authority"?: string | null,"created_at"?: string,"evidence_list"?: Json | null,"fee"?: string | null,"id"?: string,"kind": string,"last_verified_at"?: string | null,"lead_time_days"?: number | null,"legal_basis"?: string | null,"node_id": string,"product_class"?: string,"renewal_cycle"?: string | null,"route"?: string | null,"source_url"?: string | null,"submission_language"?: string | null
                  }
                  Update: {
                    "authority"?: string | null,"created_at"?: string,"evidence_list"?: Json | null,"fee"?: string | null,"id"?: string,"kind"?: string,"last_verified_at"?: string | null,"lead_time_days"?: number | null,"legal_basis"?: string | null,"node_id"?: string,"product_class"?: string,"renewal_cycle"?: string | null,"route"?: string | null,"source_url"?: string | null,"submission_language"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "obligations_node_id_fkey"
      columns: ["node_id"]
isOneToOne: false
      referencedRelation: "jurisdictions"
      referencedColumns: ["id"]
    }
                  ]
                },"rule_candidates": {
                  Row: {
                    "agree": boolean | null,"article": string,"created_at": string,"decided_at": string | null,"decided_by": string | null,"decision": string,"first_value": Json | null,"id": string,"proposed_rule_key": string | null,"second_value": Json | null,"source_id": string,"source_ref": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "agree"?: boolean | null,"article": string,"created_at"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"decision"?: string,"first_value"?: Json | null,"id"?: string,"proposed_rule_key"?: string | null,"second_value"?: Json | null,"source_id": string,"source_ref"?: string | null
                  }
                  Update: {
                    "agree"?: boolean | null,"article"?: string,"created_at"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"decision"?: string,"first_value"?: Json | null,"id"?: string,"proposed_rule_key"?: string | null,"second_value"?: Json | null,"source_id"?: string,"source_ref"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "rule_candidates_source_id_fkey"
      columns: ["source_id"]
isOneToOne: false
      referencedRelation: "sources"
      referencedColumns: ["id"]
    }
                  ]
                },"rule_diffs": {
                  Row: {
                    "created_at": string,"effect_type": string,"effective_from": string | null,"from_version": number | null,"id": string,"rule_key": string,"ruleset_version": string,"sell_through_until": string | null,"to_version": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"effect_type": string,"effective_from"?: string | null,"from_version"?: number | null,"id"?: string,"rule_key": string,"ruleset_version": string,"sell_through_until"?: string | null,"to_version"?: number | null
                  }
                  Update: {
                    "created_at"?: string,"effect_type"?: string,"effective_from"?: string | null,"from_version"?: number | null,"id"?: string,"rule_key"?: string,"ruleset_version"?: string,"sell_through_until"?: string | null,"to_version"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "rule_diffs_rule_key_fkey"
      columns: ["rule_key"]
isOneToOne: false
      referencedRelation: "rules"
      referencedColumns: ["rule_key"]
    },{
      foreignKeyName: "rule_diffs_ruleset_version_fkey"
      columns: ["ruleset_version"]
isOneToOne: false
      referencedRelation: "ruleset_versions"
      referencedColumns: ["id"]
    }
                  ]
                },"rule_fixtures": {
                  Row: {
                    "expected": Json | null,"expected_outcome": string,"id": string,"input": NonNullable<Json>,"name": string,"rule_key": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "expected"?: Json | null,"expected_outcome": string,"id"?: string,"input": NonNullable<Json>,"name": string,"rule_key": string,"version": number
                  }
                  Update: {
                    "expected"?: Json | null,"expected_outcome"?: string,"id"?: string,"input"?: NonNullable<Json>,"name"?: string,"rule_key"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "rule_fixtures_rule_key_version_fkey"
      columns: ["rule_key","version"]
isOneToOne: false
      referencedRelation: "rule_versions"
      referencedColumns: ["rule_key","version"]
    }
                  ]
                },"rule_versions": {
                  Row: {
                    "accepted_at": string | null,"accepted_by": string | null,"applicability": NonNullable<Json>,"article_ref": string,"created_at": string,"effect_type": string | null,"effective_from": string | null,"extraction_a": Json | null,"extraction_b": Json | null,"params": NonNullable<Json>,"rule_key": string,"sell_through_until": string | null,"source_excerpt": string | null,"source_id": string | null,"status": string,"supersedes_version": number | null,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "accepted_at"?: string | null,"accepted_by"?: string | null,"applicability"?: NonNullable<Json>,"article_ref": string,"created_at"?: string,"effect_type"?: string | null,"effective_from"?: string | null,"extraction_a"?: Json | null,"extraction_b"?: Json | null,"params"?: NonNullable<Json>,"rule_key": string,"sell_through_until"?: string | null,"source_excerpt"?: string | null,"source_id"?: string | null,"status"?: string,"supersedes_version"?: number | null,"version": number
                  }
                  Update: {
                    "accepted_at"?: string | null,"accepted_by"?: string | null,"applicability"?: NonNullable<Json>,"article_ref"?: string,"created_at"?: string,"effect_type"?: string | null,"effective_from"?: string | null,"extraction_a"?: Json | null,"extraction_b"?: Json | null,"params"?: NonNullable<Json>,"rule_key"?: string,"sell_through_until"?: string | null,"source_excerpt"?: string | null,"source_id"?: string | null,"status"?: string,"supersedes_version"?: number | null,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "rule_versions_rule_key_fkey"
      columns: ["rule_key"]
isOneToOne: false
      referencedRelation: "rules"
      referencedColumns: ["rule_key"]
    },{
      foreignKeyName: "rule_versions_source_id_fkey"
      columns: ["source_id"]
isOneToOne: false
      referencedRelation: "sources"
      referencedColumns: ["id"]
    }
                  ]
                },"rules": {
                  Row: {
                    "created_at": string,"domain": string,"node_id": string,"rule_key": string,"shape": string,"title": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"domain": string,"node_id": string,"rule_key": string,"shape": string,"title": string
                  }
                  Update: {
                    "created_at"?: string,"domain"?: string,"node_id"?: string,"rule_key"?: string,"shape"?: string,"title"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "rules_node_id_fkey"
      columns: ["node_id"]
isOneToOne: false
      referencedRelation: "jurisdictions"
      referencedColumns: ["id"]
    }
                  ]
                },"ruleset_members": {
                  Row: {
                    "rule_key": string,"ruleset_version": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "rule_key": string,"ruleset_version": string,"version": number
                  }
                  Update: {
                    "rule_key"?: string,"ruleset_version"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "ruleset_members_rule_key_version_fkey"
      columns: ["rule_key","version"]
isOneToOne: false
      referencedRelation: "rule_versions"
      referencedColumns: ["rule_key","version"]
    },{
      foreignKeyName: "ruleset_members_ruleset_version_fkey"
      columns: ["ruleset_version"]
isOneToOne: false
      referencedRelation: "ruleset_versions"
      referencedColumns: ["id"]
    }
                  ]
                },"ruleset_versions": {
                  Row: {
                    "id": string,"notes": string,"released_at": string,"released_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "id": string,"notes"?: string,"released_at"?: string,"released_by"?: string | null
                  }
                  Update: {
                    "id"?: string,"notes"?: string,"released_at"?: string,"released_by"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"sources": {
                  Row: {
                    "celex": string | null,"created_at": string,"id": string,"kind": string,"language": string | null,"licence": string,"retrieved_at": string | null,"sha256": string | null,"storage_path": string | null,"title": string,"url": string
                  }
                  ComputedFields: never
                  Insert: {
                    "celex"?: string | null,"created_at"?: string,"id"?: string,"kind": string,"language"?: string | null,"licence"?: string,"retrieved_at"?: string | null,"sha256"?: string | null,"storage_path"?: string | null,"title": string,"url": string
                  }
                  Update: {
                    "celex"?: string | null,"created_at"?: string,"id"?: string,"kind"?: string,"language"?: string | null,"licence"?: string,"retrieved_at"?: string | null,"sha256"?: string | null,"storage_path"?: string | null,"title"?: string,"url"?: string
                  }
                  Relationships: [
                    
                  ]
                },"term_decisions": {
                  Row: {
                    "created_at": string,"decided_by": string,"decision": string,"id": string,"note": string | null,"term_entry_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"decided_by": string,"decision": string,"id"?: string,"note"?: string | null,"term_entry_id": string
                  }
                  Update: {
                    "created_at"?: string,"decided_by"?: string,"decision"?: string,"id"?: string,"note"?: string | null,"term_entry_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "term_decisions_term_entry_id_fkey"
      columns: ["term_entry_id"]
isOneToOne: false
      referencedRelation: "term_entries"
      referencedColumns: ["id"]
    }
                  ]
                },"term_entries": {
                  Row: {
                    "article_ref": string,"created_at": string,"id": string,"kind": string,"language": string,"ruleset_version": string | null,"source_id": string | null,"status": string,"term": string,"term_key": string
                  }
                  ComputedFields: never
                  Insert: {
                    "article_ref": string,"created_at"?: string,"id"?: string,"kind": string,"language": string,"ruleset_version"?: string | null,"source_id"?: string | null,"status"?: string,"term": string,"term_key": string
                  }
                  Update: {
                    "article_ref"?: string,"created_at"?: string,"id"?: string,"kind"?: string,"language"?: string,"ruleset_version"?: string | null,"source_id"?: string | null,"status"?: string,"term"?: string,"term_key"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "term_entries_ruleset_version_fkey"
      columns: ["ruleset_version"]
isOneToOne: false
      referencedRelation: "ruleset_versions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "term_entries_source_id_fkey"
      columns: ["source_id"]
isOneToOne: false
      referencedRelation: "sources"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            [_ in never]: never
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "app": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            
          }
        },"ref": {
          Enums: {
            
          }
        }
} as const
