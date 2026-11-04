
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
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
            "activity_logs": {
                  Row: {
                    "action": string,"actor_id": string | null,"actor_type": Database["public"]['Enums']["actor_type"],"agent": Database["public"]['Enums']["agent_key"] | null,"created_at": string,"entity_id": string | null,"entity_type": string | null,"error_message": string | null,"id": string,"input_ref": Json | null,"metadata": NonNullable<Json>,"output_ref": Json | null,"project_id": string | null,"status": Database["public"]['Enums']["log_status"]
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_id"?: string | null,"actor_type": Database["public"]['Enums']["actor_type"],"agent"?: Database["public"]['Enums']["agent_key"] | null,"created_at"?: string,"entity_id"?: string | null,"entity_type"?: string | null,"error_message"?: string | null,"id"?: string,"input_ref"?: Json | null,"metadata"?: NonNullable<Json>,"output_ref"?: Json | null,"project_id"?: string | null,"status"?: Database["public"]['Enums']["log_status"]
                  }
                  Update: {
                    "action"?: string,"actor_id"?: string | null,"actor_type"?: Database["public"]['Enums']["actor_type"],"agent"?: Database["public"]['Enums']["agent_key"] | null,"created_at"?: string,"entity_id"?: string | null,"entity_type"?: string | null,"error_message"?: string | null,"id"?: string,"input_ref"?: Json | null,"metadata"?: NonNullable<Json>,"output_ref"?: Json | null,"project_id"?: string | null,"status"?: Database["public"]['Enums']["log_status"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "activity_logs_actor_id_fkey"
      columns: ["actor_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "activity_logs_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    }
                  ]
                },"agent_runs": {
                  Row: {
                    "agent": Database["public"]['Enums']["agent_key"],"cost_usd": number | null,"created_at": string,"created_by": string | null,"error_message": string | null,"finished_at": string | null,"id": string,"input_ref": NonNullable<Json>,"model": string | null,"output_ref": NonNullable<Json>,"parent_run_id": string | null,"project_id": string | null,"provider": string | null,"started_at": string | null,"status": Database["public"]['Enums']["job_status"],"tokens_in": number | null,"tokens_out": number | null,"triggered_by": Database["public"]['Enums']["run_trigger"]
                  }
                  ComputedFields: never
                  Insert: {
                    "agent": Database["public"]['Enums']["agent_key"],"cost_usd"?: number | null,"created_at"?: string,"created_by"?: string | null,"error_message"?: string | null,"finished_at"?: string | null,"id"?: string,"input_ref"?: NonNullable<Json>,"model"?: string | null,"output_ref"?: NonNullable<Json>,"parent_run_id"?: string | null,"project_id"?: string | null,"provider"?: string | null,"started_at"?: string | null,"status"?: Database["public"]['Enums']["job_status"],"tokens_in"?: number | null,"tokens_out"?: number | null,"triggered_by"?: Database["public"]['Enums']["run_trigger"]
                  }
                  Update: {
                    "agent"?: Database["public"]['Enums']["agent_key"],"cost_usd"?: number | null,"created_at"?: string,"created_by"?: string | null,"error_message"?: string | null,"finished_at"?: string | null,"id"?: string,"input_ref"?: NonNullable<Json>,"model"?: string | null,"output_ref"?: NonNullable<Json>,"parent_run_id"?: string | null,"project_id"?: string | null,"provider"?: string | null,"started_at"?: string | null,"status"?: Database["public"]['Enums']["job_status"],"tokens_in"?: number | null,"tokens_out"?: number | null,"triggered_by"?: Database["public"]['Enums']["run_trigger"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "agent_runs_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "agent_runs_parent_run_id_fkey"
      columns: ["parent_run_id"]
isOneToOne: false
      referencedRelation: "agent_runs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "agent_runs_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    }
                  ]
                },"agent_tasks": {
                  Row: {
                    "agent": Database["public"]['Enums']["agent_key"],"attempts": number,"created_at": string,"created_by": string | null,"due_at": string | null,"entity_id": string | null,"entity_type": string | null,"error_message": string | null,"id": string,"input": NonNullable<Json>,"output": Json | null,"priority": number,"project_id": string | null,"requires_approval": boolean,"run_id": string | null,"status": Database["public"]['Enums']["task_status"],"task_type": string,"title": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "agent": Database["public"]['Enums']["agent_key"],"attempts"?: number,"created_at"?: string,"created_by"?: string | null,"due_at"?: string | null,"entity_id"?: string | null,"entity_type"?: string | null,"error_message"?: string | null,"id"?: string,"input"?: NonNullable<Json>,"output"?: Json | null,"priority"?: number,"project_id"?: string | null,"requires_approval"?: boolean,"run_id"?: string | null,"status"?: Database["public"]['Enums']["task_status"],"task_type": string,"title": string,"updated_at"?: string
                  }
                  Update: {
                    "agent"?: Database["public"]['Enums']["agent_key"],"attempts"?: number,"created_at"?: string,"created_by"?: string | null,"due_at"?: string | null,"entity_id"?: string | null,"entity_type"?: string | null,"error_message"?: string | null,"id"?: string,"input"?: NonNullable<Json>,"output"?: Json | null,"priority"?: number,"project_id"?: string | null,"requires_approval"?: boolean,"run_id"?: string | null,"status"?: Database["public"]['Enums']["task_status"],"task_type"?: string,"title"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "agent_tasks_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "agent_tasks_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "agent_tasks_run_id_fkey"
      columns: ["run_id"]
isOneToOne: false
      referencedRelation: "agent_runs"
      referencedColumns: ["id"]
    }
                  ]
                },"ai_usage": {
                  Row: {
                    "agent_run_id": string | null,"attempt": number,"cache_read_tokens": number,"cache_write_tokens": number,"cost_usd": number | null,"created_at": string,"error_code": string | null,"id": string,"input_tokens": number,"job_id": string | null,"latency_ms": number | null,"model": string,"output_tokens": number,"project_id": string | null,"provider": string,"status": string,"task": Database["public"]['Enums']["ai_task"]
                  }
                  ComputedFields: never
                  Insert: {
                    "agent_run_id"?: string | null,"attempt"?: number,"cache_read_tokens"?: number,"cache_write_tokens"?: number,"cost_usd"?: number | null,"created_at"?: string,"error_code"?: string | null,"id"?: string,"input_tokens"?: number,"job_id"?: string | null,"latency_ms"?: number | null,"model": string,"output_tokens"?: number,"project_id"?: string | null,"provider": string,"status": string,"task": Database["public"]['Enums']["ai_task"]
                  }
                  Update: {
                    "agent_run_id"?: string | null,"attempt"?: number,"cache_read_tokens"?: number,"cache_write_tokens"?: number,"cost_usd"?: number | null,"created_at"?: string,"error_code"?: string | null,"id"?: string,"input_tokens"?: number,"job_id"?: string | null,"latency_ms"?: number | null,"model"?: string,"output_tokens"?: number,"project_id"?: string | null,"provider"?: string,"status"?: string,"task"?: Database["public"]['Enums']["ai_task"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "ai_usage_agent_run_id_fkey"
      columns: ["agent_run_id"]
isOneToOne: false
      referencedRelation: "agent_runs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ai_usage_job_id_fkey"
      columns: ["job_id"]
isOneToOne: false
      referencedRelation: "jobs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ai_usage_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    }
                  ]
                },"analytics": {
                  Row: {
                    "avg_percentage_viewed": number | null,"captured_at": string,"comments": number | null,"content_item_id": string,"created_at": string,"ctr": number | null,"id": string,"likes": number | null,"platform": Database["public"]['Enums']["platform"],"project_id": string,"publishing_job_id": string | null,"raw": Json | null,"shares": number | null,"subscribers_gained": number | null,"views": number | null,"watch_time_sec": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "avg_percentage_viewed"?: number | null,"captured_at"?: string,"comments"?: number | null,"content_item_id": string,"created_at"?: string,"ctr"?: number | null,"id"?: string,"likes"?: number | null,"platform": Database["public"]['Enums']["platform"],"project_id": string,"publishing_job_id"?: string | null,"raw"?: Json | null,"shares"?: number | null,"subscribers_gained"?: number | null,"views"?: number | null,"watch_time_sec"?: number | null
                  }
                  Update: {
                    "avg_percentage_viewed"?: number | null,"captured_at"?: string,"comments"?: number | null,"content_item_id"?: string,"created_at"?: string,"ctr"?: number | null,"id"?: string,"likes"?: number | null,"platform"?: Database["public"]['Enums']["platform"],"project_id"?: string,"publishing_job_id"?: string | null,"raw"?: Json | null,"shares"?: number | null,"subscribers_gained"?: number | null,"views"?: number | null,"watch_time_sec"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "analytics_content_item_id_project_id_fkey"
      columns: ["content_item_id","project_id"]
isOneToOne: false
      referencedRelation: "content_items"
      referencedColumns: ["id","project_id"]
    },{
      foreignKeyName: "analytics_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "analytics_publishing_job_id_project_id_fkey"
      columns: ["publishing_job_id","project_id"]
isOneToOne: false
      referencedRelation: "publishing_jobs"
      referencedColumns: ["id","project_id"]
    }
                  ]
                },"approvals": {
                  Row: {
                    "checkpoint": Database["public"]['Enums']["approval_checkpoint"],"created_at": string,"decided_by": string,"decision": Database["public"]['Enums']["approval_decision"],"entity_id": string,"entity_type": string,"id": string,"notes": string | null,"project_id": string,"seq": number
                  }
                  ComputedFields: never
                  Insert: {
                    "checkpoint": Database["public"]['Enums']["approval_checkpoint"],"created_at"?: string,"decided_by": string,"decision": Database["public"]['Enums']["approval_decision"],"entity_id": string,"entity_type": string,"id"?: string,"notes"?: string | null,"project_id": string,"seq"?: never
                  }
                  Update: {
                    "checkpoint"?: Database["public"]['Enums']["approval_checkpoint"],"created_at"?: string,"decided_by"?: string,"decision"?: Database["public"]['Enums']["approval_decision"],"entity_id"?: string,"entity_type"?: string,"id"?: string,"notes"?: string | null,"project_id"?: string,"seq"?: never
                  }
                  Relationships: [
                    {
      foreignKeyName: "approvals_decided_by_fkey"
      columns: ["decided_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "approvals_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    }
                  ]
                },"captions": {
                  Row: {
                    "clip_id": string,"created_at": string,"format": Database["public"]['Enums']["caption_format"],"id": string,"language": string | null,"max_lines": number,"position": string,"preset": Database["public"]['Enums']["caption_preset"],"project_id": string,"storage_path": string | null,"updated_at": string,"word_highlight": boolean
                  }
                  ComputedFields: never
                  Insert: {
                    "clip_id": string,"created_at"?: string,"format": Database["public"]['Enums']["caption_format"],"id"?: string,"language"?: string | null,"max_lines"?: number,"position"?: string,"preset"?: Database["public"]['Enums']["caption_preset"],"project_id": string,"storage_path"?: string | null,"updated_at"?: string,"word_highlight"?: boolean
                  }
                  Update: {
                    "clip_id"?: string,"created_at"?: string,"format"?: Database["public"]['Enums']["caption_format"],"id"?: string,"language"?: string | null,"max_lines"?: number,"position"?: string,"preset"?: Database["public"]['Enums']["caption_preset"],"project_id"?: string,"storage_path"?: string | null,"updated_at"?: string,"word_highlight"?: boolean
                  }
                  Relationships: [
                    {
      foreignKeyName: "captions_clip_id_project_id_fkey"
      columns: ["clip_id","project_id"]
isOneToOne: false
      referencedRelation: "clips"
      referencedColumns: ["id","project_id"]
    },{
      foreignKeyName: "captions_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    }
                  ]
                },"clips": {
                  Row: {
                    "aspect_ratio": string,"content_item_id": string | null,"created_at": string,"duration_sec": number | null,"edit_settings": NonNullable<Json>,"end_sec": number,"error_message": string | null,"height": number,"hook": string | null,"id": string,"output_path": string | null,"preview_path": string | null,"project_id": string,"reason": string | null,"reframe_data": Json | null,"reframe_mode": Database["public"]['Enums']["reframe_mode"],"segment_id": string | null,"start_sec": number,"status": Database["public"]['Enums']["clip_status"],"title": string | null,"updated_at": string,"video_id": string,"virality_breakdown": NonNullable<Json>,"virality_score": number | null,"width": number
                  }
                  ComputedFields: never
                  Insert: {
                    "aspect_ratio"?: string,"content_item_id"?: string | null,"created_at"?: string,"duration_sec"?: never,"edit_settings"?: NonNullable<Json>,"end_sec": number,"error_message"?: string | null,"height"?: number,"hook"?: string | null,"id"?: string,"output_path"?: string | null,"preview_path"?: string | null,"project_id": string,"reason"?: string | null,"reframe_data"?: Json | null,"reframe_mode"?: Database["public"]['Enums']["reframe_mode"],"segment_id"?: string | null,"start_sec": number,"status"?: Database["public"]['Enums']["clip_status"],"title"?: string | null,"updated_at"?: string,"video_id": string,"virality_breakdown"?: NonNullable<Json>,"virality_score"?: number | null,"width"?: number
                  }
                  Update: {
                    "aspect_ratio"?: string,"content_item_id"?: string | null,"created_at"?: string,"duration_sec"?: never,"edit_settings"?: NonNullable<Json>,"end_sec"?: number,"error_message"?: string | null,"height"?: number,"hook"?: string | null,"id"?: string,"output_path"?: string | null,"preview_path"?: string | null,"project_id"?: string,"reason"?: string | null,"reframe_data"?: Json | null,"reframe_mode"?: Database["public"]['Enums']["reframe_mode"],"segment_id"?: string | null,"start_sec"?: number,"status"?: Database["public"]['Enums']["clip_status"],"title"?: string | null,"updated_at"?: string,"video_id"?: string,"virality_breakdown"?: NonNullable<Json>,"virality_score"?: number | null,"width"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "clips_content_item_id_project_id_fkey"
      columns: ["content_item_id","project_id"]
isOneToOne: false
      referencedRelation: "content_items"
      referencedColumns: ["id","project_id"]
    },{
      foreignKeyName: "clips_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "clips_segment_id_project_id_fkey"
      columns: ["segment_id","project_id"]
isOneToOne: false
      referencedRelation: "video_segments"
      referencedColumns: ["id","project_id"]
    },{
      foreignKeyName: "clips_video_id_project_id_fkey"
      columns: ["video_id","project_id"]
isOneToOne: false
      referencedRelation: "videos"
      referencedColumns: ["id","project_id"]
    }
                  ]
                },"connectors": {
                  Row: {
                    "config": NonNullable<Json>,"created_at": string,"created_by": string | null,"credibility": number | null,"default_license": Database["public"]['Enums']["license_status"],"enabled": boolean,"etag": string | null,"fetch_interval_minutes": number,"id": string,"kind": Database["public"]['Enums']["connector_kind"],"last_error": string | null,"last_fetched_at": string | null,"last_item_count": number | null,"last_modified": string | null,"last_status": string | null,"name": string,"project_id": string,"sport_id": string | null,"target": string,"updated_at": string,"url": string
                  }
                  ComputedFields: never
                  Insert: {
                    "config"?: NonNullable<Json>,"created_at"?: string,"created_by"?: string | null,"credibility"?: number | null,"default_license"?: Database["public"]['Enums']["license_status"],"enabled"?: boolean,"etag"?: string | null,"fetch_interval_minutes"?: number,"id"?: string,"kind": Database["public"]['Enums']["connector_kind"],"last_error"?: string | null,"last_fetched_at"?: string | null,"last_item_count"?: number | null,"last_modified"?: string | null,"last_status"?: string | null,"name": string,"project_id": string,"sport_id"?: string | null,"target"?: string,"updated_at"?: string,"url": string
                  }
                  Update: {
                    "config"?: NonNullable<Json>,"created_at"?: string,"created_by"?: string | null,"credibility"?: number | null,"default_license"?: Database["public"]['Enums']["license_status"],"enabled"?: boolean,"etag"?: string | null,"fetch_interval_minutes"?: number,"id"?: string,"kind"?: Database["public"]['Enums']["connector_kind"],"last_error"?: string | null,"last_fetched_at"?: string | null,"last_item_count"?: number | null,"last_modified"?: string | null,"last_status"?: string | null,"name"?: string,"project_id"?: string,"sport_id"?: string | null,"target"?: string,"updated_at"?: string,"url"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "connectors_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "connectors_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "connectors_sport_id_fkey"
      columns: ["sport_id"]
isOneToOne: false
      referencedRelation: "sports"
      referencedColumns: ["id"]
    }
                  ]
                },"content_items": {
                  Row: {
                    "created_at": string,"created_by": string | null,"description": string | null,"format": Database["public"]['Enums']["content_format"],"id": string,"metadata": NonNullable<Json>,"opportunity_id": string | null,"position": number,"predicted_score": number | null,"project_id": string,"published_at": string | null,"scheduled_at": string | null,"stage": Database["public"]['Enums']["content_stage"],"stage_changed_at": string,"story_id": string | null,"target_platforms": (Database["public"]['Enums']["platform"])[],"title": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"description"?: string | null,"format"?: Database["public"]['Enums']["content_format"],"id"?: string,"metadata"?: NonNullable<Json>,"opportunity_id"?: string | null,"position"?: number,"predicted_score"?: number | null,"project_id": string,"published_at"?: string | null,"scheduled_at"?: string | null,"stage"?: Database["public"]['Enums']["content_stage"],"stage_changed_at"?: string,"story_id"?: string | null,"target_platforms"?: (Database["public"]['Enums']["platform"])[],"title": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"description"?: string | null,"format"?: Database["public"]['Enums']["content_format"],"id"?: string,"metadata"?: NonNullable<Json>,"opportunity_id"?: string | null,"position"?: number,"predicted_score"?: number | null,"project_id"?: string,"published_at"?: string | null,"scheduled_at"?: string | null,"stage"?: Database["public"]['Enums']["content_stage"],"stage_changed_at"?: string,"story_id"?: string | null,"target_platforms"?: (Database["public"]['Enums']["platform"])[],"title"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "content_items_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "content_items_opportunity_id_project_id_fkey"
      columns: ["opportunity_id","project_id"]
isOneToOne: false
      referencedRelation: "opportunities"
      referencedColumns: ["id","project_id"]
    },{
      foreignKeyName: "content_items_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "content_items_story_id_project_id_fkey"
      columns: ["story_id","project_id"]
isOneToOne: false
      referencedRelation: "stories"
      referencedColumns: ["id","project_id"]
    }
                  ]
                },"events": {
                  Row: {
                    "competition": string | null,"connector_id": string | null,"created_at": string,"description": string | null,"ends_at": string | null,"external_id": string | null,"id": string,"importance": number | null,"metadata": NonNullable<Json>,"project_id": string,"sport_id": string | null,"starts_at": string | null,"status": Database["public"]['Enums']["event_status"],"title": string,"updated_at": string,"venue": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "competition"?: string | null,"connector_id"?: string | null,"created_at"?: string,"description"?: string | null,"ends_at"?: string | null,"external_id"?: string | null,"id"?: string,"importance"?: number | null,"metadata"?: NonNullable<Json>,"project_id": string,"sport_id"?: string | null,"starts_at"?: string | null,"status"?: Database["public"]['Enums']["event_status"],"title": string,"updated_at"?: string,"venue"?: string | null
                  }
                  Update: {
                    "competition"?: string | null,"connector_id"?: string | null,"created_at"?: string,"description"?: string | null,"ends_at"?: string | null,"external_id"?: string | null,"id"?: string,"importance"?: number | null,"metadata"?: NonNullable<Json>,"project_id"?: string,"sport_id"?: string | null,"starts_at"?: string | null,"status"?: Database["public"]['Enums']["event_status"],"title"?: string,"updated_at"?: string,"venue"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "events_connector_fk"
      columns: ["connector_id","project_id"]
isOneToOne: false
      referencedRelation: "connectors"
      referencedColumns: ["id","project_id"]
    },{
      foreignKeyName: "events_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "events_sport_id_fkey"
      columns: ["sport_id"]
isOneToOne: false
      referencedRelation: "sports"
      referencedColumns: ["id"]
    }
                  ]
                },"fact_sources": {
                  Row: {
                    "created_at": string,"created_by": string | null,"excerpt": string | null,"fact_id": string,"locator": string | null,"project_id": string,"relation": Database["public"]['Enums']["claim_relation"],"source_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"excerpt"?: string | null,"fact_id": string,"locator"?: string | null,"project_id": string,"relation"?: Database["public"]['Enums']["claim_relation"],"source_id": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"excerpt"?: string | null,"fact_id"?: string,"locator"?: string | null,"project_id"?: string,"relation"?: Database["public"]['Enums']["claim_relation"],"source_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "fact_sources_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "fact_sources_fact_id_project_id_fkey"
      columns: ["fact_id","project_id"]
isOneToOne: false
      referencedRelation: "facts"
      referencedColumns: ["id","project_id"]
    },{
      foreignKeyName: "fact_sources_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "fact_sources_source_id_project_id_fkey"
      columns: ["source_id","project_id"]
isOneToOne: false
      referencedRelation: "sources"
      referencedColumns: ["id","project_id"]
    }
                  ]
                },"facts": {
                  Row: {
                    "ai_suggestion": Json | null,"checked_at": string | null,"checked_by": string | null,"checked_by_agent": Database["public"]['Enums']["agent_key"] | null,"claim": string,"confidence": number | null,"content_item_id": string | null,"created_at": string,"id": string,"is_critical": boolean,"notes": string | null,"opportunity_id": string | null,"project_id": string,"status": Database["public"]['Enums']["fact_status"],"story_id": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "ai_suggestion"?: Json | null,"checked_at"?: string | null,"checked_by"?: string | null,"checked_by_agent"?: Database["public"]['Enums']["agent_key"] | null,"claim": string,"confidence"?: number | null,"content_item_id"?: string | null,"created_at"?: string,"id"?: string,"is_critical"?: boolean,"notes"?: string | null,"opportunity_id"?: string | null,"project_id": string,"status"?: Database["public"]['Enums']["fact_status"],"story_id"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "ai_suggestion"?: Json | null,"checked_at"?: string | null,"checked_by"?: string | null,"checked_by_agent"?: Database["public"]['Enums']["agent_key"] | null,"claim"?: string,"confidence"?: number | null,"content_item_id"?: string | null,"created_at"?: string,"id"?: string,"is_critical"?: boolean,"notes"?: string | null,"opportunity_id"?: string | null,"project_id"?: string,"status"?: Database["public"]['Enums']["fact_status"],"story_id"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "facts_checked_by_fkey"
      columns: ["checked_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "facts_content_item_id_project_id_fkey"
      columns: ["content_item_id","project_id"]
isOneToOne: false
      referencedRelation: "content_items"
      referencedColumns: ["id","project_id"]
    },{
      foreignKeyName: "facts_opportunity_id_project_id_fkey"
      columns: ["opportunity_id","project_id"]
isOneToOne: false
      referencedRelation: "opportunities"
      referencedColumns: ["id","project_id"]
    },{
      foreignKeyName: "facts_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "facts_story_id_project_id_fkey"
      columns: ["story_id","project_id"]
isOneToOne: false
      referencedRelation: "stories"
      referencedColumns: ["id","project_id"]
    }
                  ]
                },"hooks": {
                  Row: {
                    "angle": Database["public"]['Enums']["script_angle"] | null,"created_at": string,"hook_type": Database["public"]['Enums']["hook_type"],"id": string,"is_selected": boolean,"model": string | null,"opportunity_id": string | null,"project_id": string,"provider": string | null,"score": number | null,"score_explanation": Json | null,"script_id": string | null,"story_id": string | null,"text": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "angle"?: Database["public"]['Enums']["script_angle"] | null,"created_at"?: string,"hook_type": Database["public"]['Enums']["hook_type"],"id"?: string,"is_selected"?: boolean,"model"?: string | null,"opportunity_id"?: string | null,"project_id": string,"provider"?: string | null,"score"?: number | null,"score_explanation"?: Json | null,"script_id"?: string | null,"story_id"?: string | null,"text": string,"updated_at"?: string
                  }
                  Update: {
                    "angle"?: Database["public"]['Enums']["script_angle"] | null,"created_at"?: string,"hook_type"?: Database["public"]['Enums']["hook_type"],"id"?: string,"is_selected"?: boolean,"model"?: string | null,"opportunity_id"?: string | null,"project_id"?: string,"provider"?: string | null,"score"?: number | null,"score_explanation"?: Json | null,"script_id"?: string | null,"story_id"?: string | null,"text"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "hooks_opportunity_id_project_id_fkey"
      columns: ["opportunity_id","project_id"]
isOneToOne: false
      referencedRelation: "opportunities"
      referencedColumns: ["id","project_id"]
    },{
      foreignKeyName: "hooks_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "hooks_script_id_project_id_fkey"
      columns: ["script_id","project_id"]
isOneToOne: false
      referencedRelation: "scripts"
      referencedColumns: ["id","project_id"]
    },{
      foreignKeyName: "hooks_story_id_project_id_fkey"
      columns: ["story_id","project_id"]
isOneToOne: false
      referencedRelation: "stories"
      referencedColumns: ["id","project_id"]
    }
                  ]
                },"jobs": {
                  Row: {
                    "attempts": number,"created_at": string,"created_by": string | null,"error_message": string | null,"finished_at": string | null,"id": string,"idempotency_key": string | null,"locked_at": string | null,"locked_by": string | null,"max_attempts": number,"payload": NonNullable<Json>,"priority": number,"project_id": string | null,"result": Json | null,"run_after": string,"started_at": string | null,"status": Database["public"]['Enums']["job_status"],"type": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "attempts"?: number,"created_at"?: string,"created_by"?: string | null,"error_message"?: string | null,"finished_at"?: string | null,"id"?: string,"idempotency_key"?: string | null,"locked_at"?: string | null,"locked_by"?: string | null,"max_attempts"?: number,"payload"?: NonNullable<Json>,"priority"?: number,"project_id"?: string | null,"result"?: Json | null,"run_after"?: string,"started_at"?: string | null,"status"?: Database["public"]['Enums']["job_status"],"type": string,"updated_at"?: string
                  }
                  Update: {
                    "attempts"?: number,"created_at"?: string,"created_by"?: string | null,"error_message"?: string | null,"finished_at"?: string | null,"id"?: string,"idempotency_key"?: string | null,"locked_at"?: string | null,"locked_by"?: string | null,"max_attempts"?: number,"payload"?: NonNullable<Json>,"priority"?: number,"project_id"?: string | null,"result"?: Json | null,"run_after"?: string,"started_at"?: string | null,"status"?: Database["public"]['Enums']["job_status"],"type"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "jobs_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "jobs_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    }
                  ]
                },"opportunities": {
                  Row: {
                    "angle": string | null,"audience_score": number | null,"competition": string | null,"competition_gap_score": number | null,"competition_level": Database["public"]['Enums']["competition_level"] | null,"created_at": string,"created_by": string | null,"curiosity_score": number | null,"description": string | null,"event_id": string | null,"hook": string | null,"id": string,"is_sweet_spot": boolean,"metadata": NonNullable<Json>,"monetization_score": number | null,"opportunity_score": number | null,"originality_score": number | null,"production_feasibility_score": number | null,"project_id": string,"rights_score": number | null,"score_coverage": number | null,"score_explanation": Json | null,"scored_at": string | null,"scoring_version": string | null,"signals": (Database["public"]['Enums']["radar_signal"])[],"sport_id": string | null,"status": Database["public"]['Enums']["opportunity_status"],"timeliness_score": number | null,"title": string,"trend_id": string | null,"trend_score": number | null,"updated_at": string,"why_now": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "angle"?: string | null,"audience_score"?: number | null,"competition"?: string | null,"competition_gap_score"?: number | null,"competition_level"?: Database["public"]['Enums']["competition_level"] | null,"created_at"?: string,"created_by"?: string | null,"curiosity_score"?: number | null,"description"?: string | null,"event_id"?: string | null,"hook"?: string | null,"id"?: string,"is_sweet_spot"?: boolean,"metadata"?: NonNullable<Json>,"monetization_score"?: number | null,"opportunity_score"?: number | null,"originality_score"?: number | null,"production_feasibility_score"?: number | null,"project_id": string,"rights_score"?: number | null,"score_coverage"?: number | null,"score_explanation"?: Json | null,"scored_at"?: string | null,"scoring_version"?: string | null,"signals"?: (Database["public"]['Enums']["radar_signal"])[],"sport_id"?: string | null,"status"?: Database["public"]['Enums']["opportunity_status"],"timeliness_score"?: number | null,"title": string,"trend_id"?: string | null,"trend_score"?: number | null,"updated_at"?: string,"why_now"?: string | null
                  }
                  Update: {
                    "angle"?: string | null,"audience_score"?: number | null,"competition"?: string | null,"competition_gap_score"?: number | null,"competition_level"?: Database["public"]['Enums']["competition_level"] | null,"created_at"?: string,"created_by"?: string | null,"curiosity_score"?: number | null,"description"?: string | null,"event_id"?: string | null,"hook"?: string | null,"id"?: string,"is_sweet_spot"?: boolean,"metadata"?: NonNullable<Json>,"monetization_score"?: number | null,"opportunity_score"?: number | null,"originality_score"?: number | null,"production_feasibility_score"?: number | null,"project_id"?: string,"rights_score"?: number | null,"score_coverage"?: number | null,"score_explanation"?: Json | null,"scored_at"?: string | null,"scoring_version"?: string | null,"signals"?: (Database["public"]['Enums']["radar_signal"])[],"sport_id"?: string | null,"status"?: Database["public"]['Enums']["opportunity_status"],"timeliness_score"?: number | null,"title"?: string,"trend_id"?: string | null,"trend_score"?: number | null,"updated_at"?: string,"why_now"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "opportunities_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "opportunities_event_id_project_id_fkey"
      columns: ["event_id","project_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id","project_id"]
    },{
      foreignKeyName: "opportunities_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "opportunities_sport_id_fkey"
      columns: ["sport_id"]
isOneToOne: false
      referencedRelation: "sports"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "opportunities_trend_id_project_id_fkey"
      columns: ["trend_id","project_id"]
isOneToOne: false
      referencedRelation: "trends"
      referencedColumns: ["id","project_id"]
    }
                  ]
                },"platform_accounts": {
                  Row: {
                    "account_name": string | null,"connected_at": string | null,"created_at": string,"external_account_id": string | null,"id": string,"last_error": string | null,"metadata": NonNullable<Json>,"platform": Database["public"]['Enums']["platform"],"project_id": string,"scopes": (string)[],"status": Database["public"]['Enums']["connection_status"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_name"?: string | null,"connected_at"?: string | null,"created_at"?: string,"external_account_id"?: string | null,"id"?: string,"last_error"?: string | null,"metadata"?: NonNullable<Json>,"platform": Database["public"]['Enums']["platform"],"project_id": string,"scopes"?: (string)[],"status"?: Database["public"]['Enums']["connection_status"],"updated_at"?: string
                  }
                  Update: {
                    "account_name"?: string | null,"connected_at"?: string | null,"created_at"?: string,"external_account_id"?: string | null,"id"?: string,"last_error"?: string | null,"metadata"?: NonNullable<Json>,"platform"?: Database["public"]['Enums']["platform"],"project_id"?: string,"scopes"?: (string)[],"status"?: Database["public"]['Enums']["connection_status"],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "platform_accounts_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    }
                  ]
                },"project_members": {
                  Row: {
                    "created_at": string,"project_id": string,"role": Database["public"]['Enums']["member_role"],"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"project_id": string,"role"?: Database["public"]['Enums']["member_role"],"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"project_id"?: string,"role"?: Database["public"]['Enums']["member_role"],"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "project_members_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "project_members_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    }
                  ]
                },"projects": {
                  Row: {
                    "color": string | null,"created_at": string,"description": string | null,"id": string,"language": string,"name": string,"owner_id": string,"primary_sport_id": string | null,"slug": string,"status": Database["public"]['Enums']["project_status"],"timezone": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "color"?: string | null,"created_at"?: string,"description"?: string | null,"id"?: string,"language"?: string,"name": string,"owner_id": string,"primary_sport_id"?: string | null,"slug": string,"status"?: Database["public"]['Enums']["project_status"],"timezone"?: string,"updated_at"?: string
                  }
                  Update: {
                    "color"?: string | null,"created_at"?: string,"description"?: string | null,"id"?: string,"language"?: string,"name"?: string,"owner_id"?: string,"primary_sport_id"?: string | null,"slug"?: string,"status"?: Database["public"]['Enums']["project_status"],"timezone"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "projects_owner_id_fkey"
      columns: ["owner_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "projects_primary_sport_id_fkey"
      columns: ["primary_sport_id"]
isOneToOne: false
      referencedRelation: "sports"
      referencedColumns: ["id"]
    }
                  ]
                },"publishing_jobs": {
                  Row: {
                    "attempts": number,"content_item_id": string,"created_at": string,"created_by": string | null,"error_message": string | null,"external_post_id": string | null,"external_url": string | null,"id": string,"mode": Database["public"]['Enums']["publish_mode"],"payload": NonNullable<Json>,"platform": Database["public"]['Enums']["platform"],"platform_account_id": string | null,"project_id": string,"published_at": string | null,"scheduled_at": string | null,"status": Database["public"]['Enums']["job_status"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "attempts"?: number,"content_item_id": string,"created_at"?: string,"created_by"?: string | null,"error_message"?: string | null,"external_post_id"?: string | null,"external_url"?: string | null,"id"?: string,"mode"?: Database["public"]['Enums']["publish_mode"],"payload"?: NonNullable<Json>,"platform": Database["public"]['Enums']["platform"],"platform_account_id"?: string | null,"project_id": string,"published_at"?: string | null,"scheduled_at"?: string | null,"status"?: Database["public"]['Enums']["job_status"],"updated_at"?: string
                  }
                  Update: {
                    "attempts"?: number,"content_item_id"?: string,"created_at"?: string,"created_by"?: string | null,"error_message"?: string | null,"external_post_id"?: string | null,"external_url"?: string | null,"id"?: string,"mode"?: Database["public"]['Enums']["publish_mode"],"payload"?: NonNullable<Json>,"platform"?: Database["public"]['Enums']["platform"],"platform_account_id"?: string | null,"project_id"?: string,"published_at"?: string | null,"scheduled_at"?: string | null,"status"?: Database["public"]['Enums']["job_status"],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "publishing_jobs_content_item_id_project_id_fkey"
      columns: ["content_item_id","project_id"]
isOneToOne: false
      referencedRelation: "content_items"
      referencedColumns: ["id","project_id"]
    },{
      foreignKeyName: "publishing_jobs_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "publishing_jobs_platform_account_id_project_id_fkey"
      columns: ["platform_account_id","project_id"]
isOneToOne: false
      referencedRelation: "platform_accounts"
      referencedColumns: ["id","project_id"]
    },{
      foreignKeyName: "publishing_jobs_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    }
                  ]
                },"research_items": {
                  Row: {
                    "content": string | null,"created_at": string,"created_by": string | null,"created_by_agent": Database["public"]['Enums']["agent_key"] | null,"id": string,"item_type": Database["public"]['Enums']["research_item_type"],"metadata": NonNullable<Json>,"occurred_at": string | null,"opportunity_id": string,"position": number,"project_id": string,"source_id": string | null,"title": string | null,"updated_at": string,"url": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "content"?: string | null,"created_at"?: string,"created_by"?: string | null,"created_by_agent"?: Database["public"]['Enums']["agent_key"] | null,"id"?: string,"item_type": Database["public"]['Enums']["research_item_type"],"metadata"?: NonNullable<Json>,"occurred_at"?: string | null,"opportunity_id": string,"position"?: number,"project_id": string,"source_id"?: string | null,"title"?: string | null,"updated_at"?: string,"url"?: string | null
                  }
                  Update: {
                    "content"?: string | null,"created_at"?: string,"created_by"?: string | null,"created_by_agent"?: Database["public"]['Enums']["agent_key"] | null,"id"?: string,"item_type"?: Database["public"]['Enums']["research_item_type"],"metadata"?: NonNullable<Json>,"occurred_at"?: string | null,"opportunity_id"?: string,"position"?: number,"project_id"?: string,"source_id"?: string | null,"title"?: string | null,"updated_at"?: string,"url"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "research_items_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "research_items_opportunity_id_project_id_fkey"
      columns: ["opportunity_id","project_id"]
isOneToOne: false
      referencedRelation: "opportunities"
      referencedColumns: ["id","project_id"]
    },{
      foreignKeyName: "research_items_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "research_items_source_id_project_id_fkey"
      columns: ["source_id","project_id"]
isOneToOne: false
      referencedRelation: "sources"
      referencedColumns: ["id","project_id"]
    }
                  ]
                },"rights_checks": {
                  Row: {
                    "authorization_details": string | null,"checked_at": string,"checked_by": string | null,"checked_by_agent": Database["public"]['Enums']["agent_key"] | null,"commercial_use": boolean | null,"created_at": string,"evidence_url": string | null,"expires_at": string | null,"id": string,"license": string | null,"notes": string | null,"owner": string | null,"ownership": Database["public"]['Enums']["asset_ownership"],"project_id": string,"risk": string | null,"source_detail": string | null,"source_id": string | null,"status": Database["public"]['Enums']["rights_status"],"transformation_required": boolean,"updated_at": string,"video_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "authorization_details"?: string | null,"checked_at"?: string,"checked_by"?: string | null,"checked_by_agent"?: Database["public"]['Enums']["agent_key"] | null,"commercial_use"?: boolean | null,"created_at"?: string,"evidence_url"?: string | null,"expires_at"?: string | null,"id"?: string,"license"?: string | null,"notes"?: string | null,"owner"?: string | null,"ownership"?: Database["public"]['Enums']["asset_ownership"],"project_id": string,"risk"?: string | null,"source_detail"?: string | null,"source_id"?: string | null,"status": Database["public"]['Enums']["rights_status"],"transformation_required"?: boolean,"updated_at"?: string,"video_id"?: string | null
                  }
                  Update: {
                    "authorization_details"?: string | null,"checked_at"?: string,"checked_by"?: string | null,"checked_by_agent"?: Database["public"]['Enums']["agent_key"] | null,"commercial_use"?: boolean | null,"created_at"?: string,"evidence_url"?: string | null,"expires_at"?: string | null,"id"?: string,"license"?: string | null,"notes"?: string | null,"owner"?: string | null,"ownership"?: Database["public"]['Enums']["asset_ownership"],"project_id"?: string,"risk"?: string | null,"source_detail"?: string | null,"source_id"?: string | null,"status"?: Database["public"]['Enums']["rights_status"],"transformation_required"?: boolean,"updated_at"?: string,"video_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "rights_checks_checked_by_fkey"
      columns: ["checked_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "rights_checks_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "rights_checks_source_id_project_id_fkey"
      columns: ["source_id","project_id"]
isOneToOne: false
      referencedRelation: "sources"
      referencedColumns: ["id","project_id"]
    },{
      foreignKeyName: "rights_checks_video_id_project_id_fkey"
      columns: ["video_id","project_id"]
isOneToOne: false
      referencedRelation: "videos"
      referencedColumns: ["id","project_id"]
    }
                  ]
                },"scripts": {
                  Row: {
                    "angle": Database["public"]['Enums']["script_angle"] | null,"context": string | null,"created_at": string,"created_by": string | null,"cta": string | null,"escalation": string | null,"facts_used": (string)[],"full_text": string | null,"hook": string | null,"id": string,"is_current": boolean,"language": string | null,"model": string | null,"operation": Database["public"]['Enums']["script_operation"],"parent_script_id": string | null,"payoff": string | null,"project_id": string,"provider": string | null,"reveal": string | null,"story_id": string,"target_duration_sec": number | null,"tone": string | null,"version": number,"warnings": (string)[],"word_count": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "angle"?: Database["public"]['Enums']["script_angle"] | null,"context"?: string | null,"created_at"?: string,"created_by"?: string | null,"cta"?: string | null,"escalation"?: string | null,"facts_used"?: (string)[],"full_text"?: string | null,"hook"?: string | null,"id"?: string,"is_current"?: boolean,"language"?: string | null,"model"?: string | null,"operation"?: Database["public"]['Enums']["script_operation"],"parent_script_id"?: string | null,"payoff"?: string | null,"project_id": string,"provider"?: string | null,"reveal"?: string | null,"story_id": string,"target_duration_sec"?: number | null,"tone"?: string | null,"version": number,"warnings"?: (string)[],"word_count"?: number | null
                  }
                  Update: {
                    "angle"?: Database["public"]['Enums']["script_angle"] | null,"context"?: string | null,"created_at"?: string,"created_by"?: string | null,"cta"?: string | null,"escalation"?: string | null,"facts_used"?: (string)[],"full_text"?: string | null,"hook"?: string | null,"id"?: string,"is_current"?: boolean,"language"?: string | null,"model"?: string | null,"operation"?: Database["public"]['Enums']["script_operation"],"parent_script_id"?: string | null,"payoff"?: string | null,"project_id"?: string,"provider"?: string | null,"reveal"?: string | null,"story_id"?: string,"target_duration_sec"?: number | null,"tone"?: string | null,"version"?: number,"warnings"?: (string)[],"word_count"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "scripts_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "scripts_parent_script_id_fkey"
      columns: ["parent_script_id"]
isOneToOne: false
      referencedRelation: "scripts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "scripts_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "scripts_story_id_project_id_fkey"
      columns: ["story_id","project_id"]
isOneToOne: false
      referencedRelation: "stories"
      referencedColumns: ["id","project_id"]
    }
                  ]
                },"settings": {
                  Row: {
                    "created_at": string,"id": string,"key": string,"project_id": string | null,"updated_at": string,"updated_by": string | null,"value": NonNullable<Json>
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"key": string,"project_id"?: string | null,"updated_at"?: string,"updated_by"?: string | null,"value": NonNullable<Json>
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"key"?: string,"project_id"?: string | null,"updated_at"?: string,"updated_by"?: string | null,"value"?: NonNullable<Json>
                  }
                  Relationships: [
                    {
      foreignKeyName: "settings_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "settings_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    }
                  ]
                },"sources": {
                  Row: {
                    "author": string | null,"connector_id": string | null,"content_hash": string | null,"created_at": string,"credibility": number | null,"event_id": string | null,"id": string,"language": string | null,"license_status": Database["public"]['Enums']["license_status"],"metadata": NonNullable<Json>,"name": string,"project_id": string,"published_at": string | null,"retrieved_at": string,"rights_check_id": string | null,"rights_status": Database["public"]['Enums']["rights_status"],"signals": (Database["public"]['Enums']["radar_signal"])[],"source_type": Database["public"]['Enums']["source_type"],"sport_id": string | null,"summary": string | null,"title": string | null,"updated_at": string,"url": string,"usable_in_production": boolean
                  }
                  ComputedFields: never
                  Insert: {
                    "author"?: string | null,"connector_id"?: string | null,"content_hash"?: string | null,"created_at"?: string,"credibility"?: number | null,"event_id"?: string | null,"id"?: string,"language"?: string | null,"license_status"?: Database["public"]['Enums']["license_status"],"metadata"?: NonNullable<Json>,"name": string,"project_id": string,"published_at"?: string | null,"retrieved_at"?: string,"rights_check_id"?: string | null,"rights_status"?: Database["public"]['Enums']["rights_status"],"signals"?: (Database["public"]['Enums']["radar_signal"])[],"source_type"?: Database["public"]['Enums']["source_type"],"sport_id"?: string | null,"summary"?: string | null,"title"?: string | null,"updated_at"?: string,"url": string,"usable_in_production"?: boolean
                  }
                  Update: {
                    "author"?: string | null,"connector_id"?: string | null,"content_hash"?: string | null,"created_at"?: string,"credibility"?: number | null,"event_id"?: string | null,"id"?: string,"language"?: string | null,"license_status"?: Database["public"]['Enums']["license_status"],"metadata"?: NonNullable<Json>,"name"?: string,"project_id"?: string,"published_at"?: string | null,"retrieved_at"?: string,"rights_check_id"?: string | null,"rights_status"?: Database["public"]['Enums']["rights_status"],"signals"?: (Database["public"]['Enums']["radar_signal"])[],"source_type"?: Database["public"]['Enums']["source_type"],"sport_id"?: string | null,"summary"?: string | null,"title"?: string | null,"updated_at"?: string,"url"?: string,"usable_in_production"?: boolean
                  }
                  Relationships: [
                    {
      foreignKeyName: "sources_connector_fk"
      columns: ["connector_id","project_id"]
isOneToOne: false
      referencedRelation: "connectors"
      referencedColumns: ["id","project_id"]
    },{
      foreignKeyName: "sources_event_id_project_id_fkey"
      columns: ["event_id","project_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id","project_id"]
    },{
      foreignKeyName: "sources_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sources_sport_id_fkey"
      columns: ["sport_id"]
isOneToOne: false
      referencedRelation: "sports"
      referencedColumns: ["id"]
    }
                  ]
                },"sports": {
                  Row: {
                    "created_at": string,"id": string,"is_active": boolean,"name": string,"slug": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"is_active"?: boolean,"name": string,"slug": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"is_active"?: boolean,"name"?: string,"slug"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"stories": {
                  Row: {
                    "angle": string | null,"created_at": string,"created_by": string | null,"id": string,"logline": string | null,"metadata": NonNullable<Json>,"opportunity_id": string | null,"production_formats": (Database["public"]['Enums']["editorial_format"])[],"project_id": string,"status": Database["public"]['Enums']["story_status"],"title": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "angle"?: string | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"logline"?: string | null,"metadata"?: NonNullable<Json>,"opportunity_id"?: string | null,"production_formats"?: (Database["public"]['Enums']["editorial_format"])[],"project_id": string,"status"?: Database["public"]['Enums']["story_status"],"title": string,"updated_at"?: string
                  }
                  Update: {
                    "angle"?: string | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"logline"?: string | null,"metadata"?: NonNullable<Json>,"opportunity_id"?: string | null,"production_formats"?: (Database["public"]['Enums']["editorial_format"])[],"project_id"?: string,"status"?: Database["public"]['Enums']["story_status"],"title"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "stories_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "stories_opportunity_id_project_id_fkey"
      columns: ["opportunity_id","project_id"]
isOneToOne: false
      referencedRelation: "opportunities"
      referencedColumns: ["id","project_id"]
    },{
      foreignKeyName: "stories_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    }
                  ]
                },"thumbnails": {
                  Row: {
                    "clip_id": string | null,"content_item_id": string,"contrast": string | null,"created_at": string,"curiosity_angle": string | null,"emotion": string | null,"headline": string,"id": string,"image_prompt": string | null,"model": string | null,"project_id": string,"provider": string | null,"score": number | null,"status": Database["public"]['Enums']["thumbnail_status"],"storage_path": string | null,"subject": string | null,"updated_at": string,"visual_concept": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "clip_id"?: string | null,"content_item_id": string,"contrast"?: string | null,"created_at"?: string,"curiosity_angle"?: string | null,"emotion"?: string | null,"headline": string,"id"?: string,"image_prompt"?: string | null,"model"?: string | null,"project_id": string,"provider"?: string | null,"score"?: number | null,"status"?: Database["public"]['Enums']["thumbnail_status"],"storage_path"?: string | null,"subject"?: string | null,"updated_at"?: string,"visual_concept"?: string | null
                  }
                  Update: {
                    "clip_id"?: string | null,"content_item_id"?: string,"contrast"?: string | null,"created_at"?: string,"curiosity_angle"?: string | null,"emotion"?: string | null,"headline"?: string,"id"?: string,"image_prompt"?: string | null,"model"?: string | null,"project_id"?: string,"provider"?: string | null,"score"?: number | null,"status"?: Database["public"]['Enums']["thumbnail_status"],"storage_path"?: string | null,"subject"?: string | null,"updated_at"?: string,"visual_concept"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "thumbnails_clip_id_project_id_fkey"
      columns: ["clip_id","project_id"]
isOneToOne: false
      referencedRelation: "clips"
      referencedColumns: ["id","project_id"]
    },{
      foreignKeyName: "thumbnails_content_item_id_project_id_fkey"
      columns: ["content_item_id","project_id"]
isOneToOne: false
      referencedRelation: "content_items"
      referencedColumns: ["id","project_id"]
    },{
      foreignKeyName: "thumbnails_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    }
                  ]
                },"titles": {
                  Row: {
                    "accuracy_score": number | null,"clarity_score": number | null,"content_item_id": string,"created_at": string,"ctr_potential_score": number | null,"curiosity_score": number | null,"id": string,"is_selected": boolean,"model": string | null,"overall_score": number | null,"platform": Database["public"]['Enums']["platform"] | null,"project_id": string,"provider": string | null,"text": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "accuracy_score"?: number | null,"clarity_score"?: number | null,"content_item_id": string,"created_at"?: string,"ctr_potential_score"?: number | null,"curiosity_score"?: number | null,"id"?: string,"is_selected"?: boolean,"model"?: string | null,"overall_score"?: number | null,"platform"?: Database["public"]['Enums']["platform"] | null,"project_id": string,"provider"?: string | null,"text": string,"updated_at"?: string
                  }
                  Update: {
                    "accuracy_score"?: number | null,"clarity_score"?: number | null,"content_item_id"?: string,"created_at"?: string,"ctr_potential_score"?: number | null,"curiosity_score"?: number | null,"id"?: string,"is_selected"?: boolean,"model"?: string | null,"overall_score"?: number | null,"platform"?: Database["public"]['Enums']["platform"] | null,"project_id"?: string,"provider"?: string | null,"text"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "titles_content_item_id_project_id_fkey"
      columns: ["content_item_id","project_id"]
isOneToOne: false
      referencedRelation: "content_items"
      referencedColumns: ["id","project_id"]
    },{
      foreignKeyName: "titles_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    }
                  ]
                },"trend_sources": {
                  Row: {
                    "created_at": string,"project_id": string,"source_id": string,"trend_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"project_id": string,"source_id": string,"trend_id": string
                  }
                  Update: {
                    "created_at"?: string,"project_id"?: string,"source_id"?: string,"trend_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "trend_sources_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "trend_sources_source_id_project_id_fkey"
      columns: ["source_id","project_id"]
isOneToOne: false
      referencedRelation: "sources"
      referencedColumns: ["id","project_id"]
    },{
      foreignKeyName: "trend_sources_trend_id_project_id_fkey"
      columns: ["trend_id","project_id"]
isOneToOne: false
      referencedRelation: "trends"
      referencedColumns: ["id","project_id"]
    }
                  ]
                },"trends": {
                  Row: {
                    "competition_level": Database["public"]['Enums']["competition_level"] | null,"created_at": string,"curiosity_score": number | null,"description": string | null,"event_id": string | null,"first_seen_at": string,"id": string,"is_sweet_spot": boolean,"keywords": (string)[],"last_seen_at": string,"metadata": NonNullable<Json>,"project_id": string,"publisher_count": number | null,"radar_explanation": Json | null,"radar_score": number | null,"signals": (Database["public"]['Enums']["radar_signal"])[],"source_count": number | null,"sport_id": string | null,"status": Database["public"]['Enums']["trend_status"],"title": string,"trend_score": number | null,"updated_at": string,"velocity": number | null,"volume": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "competition_level"?: Database["public"]['Enums']["competition_level"] | null,"created_at"?: string,"curiosity_score"?: number | null,"description"?: string | null,"event_id"?: string | null,"first_seen_at"?: string,"id"?: string,"is_sweet_spot"?: boolean,"keywords"?: (string)[],"last_seen_at"?: string,"metadata"?: NonNullable<Json>,"project_id": string,"publisher_count"?: number | null,"radar_explanation"?: Json | null,"radar_score"?: number | null,"signals"?: (Database["public"]['Enums']["radar_signal"])[],"source_count"?: number | null,"sport_id"?: string | null,"status"?: Database["public"]['Enums']["trend_status"],"title": string,"trend_score"?: number | null,"updated_at"?: string,"velocity"?: number | null,"volume"?: number | null
                  }
                  Update: {
                    "competition_level"?: Database["public"]['Enums']["competition_level"] | null,"created_at"?: string,"curiosity_score"?: number | null,"description"?: string | null,"event_id"?: string | null,"first_seen_at"?: string,"id"?: string,"is_sweet_spot"?: boolean,"keywords"?: (string)[],"last_seen_at"?: string,"metadata"?: NonNullable<Json>,"project_id"?: string,"publisher_count"?: number | null,"radar_explanation"?: Json | null,"radar_score"?: number | null,"signals"?: (Database["public"]['Enums']["radar_signal"])[],"source_count"?: number | null,"sport_id"?: string | null,"status"?: Database["public"]['Enums']["trend_status"],"title"?: string,"trend_score"?: number | null,"updated_at"?: string,"velocity"?: number | null,"volume"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "trends_event_id_project_id_fkey"
      columns: ["event_id","project_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id","project_id"]
    },{
      foreignKeyName: "trends_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "trends_sport_id_fkey"
      columns: ["sport_id"]
isOneToOne: false
      referencedRelation: "sports"
      referencedColumns: ["id"]
    }
                  ]
                },"users": {
                  Row: {
                    "avatar_url": string | null,"created_at": string,"display_name": string | null,"email": string,"id": string,"role": Database["public"]['Enums']["app_role"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "avatar_url"?: string | null,"created_at"?: string,"display_name"?: string | null,"email": string,"id": string,"role"?: Database["public"]['Enums']["app_role"],"updated_at"?: string
                  }
                  Update: {
                    "avatar_url"?: string | null,"created_at"?: string,"display_name"?: string | null,"email"?: string,"id"?: string,"role"?: Database["public"]['Enums']["app_role"],"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"video_segments": {
                  Row: {
                    "ai_score": number | null,"created_at": string,"end_sec": number,"features": NonNullable<Json>,"heuristic_score": number | null,"id": string,"project_id": string,"rank": number | null,"segment_type": Database["public"]['Enums']["segment_type"],"speaker": string | null,"start_sec": number,"text": string | null,"video_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "ai_score"?: number | null,"created_at"?: string,"end_sec": number,"features"?: NonNullable<Json>,"heuristic_score"?: number | null,"id"?: string,"project_id": string,"rank"?: number | null,"segment_type": Database["public"]['Enums']["segment_type"],"speaker"?: string | null,"start_sec": number,"text"?: string | null,"video_id": string
                  }
                  Update: {
                    "ai_score"?: number | null,"created_at"?: string,"end_sec"?: number,"features"?: NonNullable<Json>,"heuristic_score"?: number | null,"id"?: string,"project_id"?: string,"rank"?: number | null,"segment_type"?: Database["public"]['Enums']["segment_type"],"speaker"?: string | null,"start_sec"?: number,"text"?: string | null,"video_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "video_segments_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "video_segments_video_id_project_id_fkey"
      columns: ["video_id","project_id"]
isOneToOne: false
      referencedRelation: "videos"
      referencedColumns: ["id","project_id"]
    }
                  ]
                },"videos": {
                  Row: {
                    "audio_path": string | null,"container": string | null,"created_at": string,"duration_sec": number | null,"error_message": string | null,"fps": number | null,"has_audio": boolean | null,"height": number | null,"id": string,"language": string | null,"metadata": NonNullable<Json>,"mime_type": string | null,"original_filename": string | null,"project_id": string,"rights_check_id": string | null,"rights_status": Database["public"]['Enums']["rights_status"],"size_bytes": number | null,"source_id": string | null,"status": Database["public"]['Enums']["video_status"],"storage_bucket": string,"storage_path": string,"title": string,"transcript_path": string | null,"updated_at": string,"uploaded_by": string | null,"usable_in_production": boolean,"width": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "audio_path"?: string | null,"container"?: string | null,"created_at"?: string,"duration_sec"?: number | null,"error_message"?: string | null,"fps"?: number | null,"has_audio"?: boolean | null,"height"?: number | null,"id"?: string,"language"?: string | null,"metadata"?: NonNullable<Json>,"mime_type"?: string | null,"original_filename"?: string | null,"project_id": string,"rights_check_id"?: string | null,"rights_status"?: Database["public"]['Enums']["rights_status"],"size_bytes"?: number | null,"source_id"?: string | null,"status"?: Database["public"]['Enums']["video_status"],"storage_bucket"?: string,"storage_path": string,"title": string,"transcript_path"?: string | null,"updated_at"?: string,"uploaded_by"?: string | null,"usable_in_production"?: boolean,"width"?: number | null
                  }
                  Update: {
                    "audio_path"?: string | null,"container"?: string | null,"created_at"?: string,"duration_sec"?: number | null,"error_message"?: string | null,"fps"?: number | null,"has_audio"?: boolean | null,"height"?: number | null,"id"?: string,"language"?: string | null,"metadata"?: NonNullable<Json>,"mime_type"?: string | null,"original_filename"?: string | null,"project_id"?: string,"rights_check_id"?: string | null,"rights_status"?: Database["public"]['Enums']["rights_status"],"size_bytes"?: number | null,"source_id"?: string | null,"status"?: Database["public"]['Enums']["video_status"],"storage_bucket"?: string,"storage_path"?: string,"title"?: string,"transcript_path"?: string | null,"updated_at"?: string,"uploaded_by"?: string | null,"usable_in_production"?: boolean,"width"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "videos_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "videos_source_id_project_id_fkey"
      columns: ["source_id","project_id"]
isOneToOne: false
      referencedRelation: "sources"
      referencedColumns: ["id","project_id"]
    },{
      foreignKeyName: "videos_uploaded_by_fkey"
      columns: ["uploaded_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            "asset_rights": {
                  Row: {
                    "asset_id": string | null,"asset_type": string | null,"authorization_details": string | null,"awaiting_approval": boolean | null,"check_id": string | null,"checked_at": string | null,"checked_by": string | null,"checked_by_agent": Database["public"]['Enums']["agent_key"] | null,"commercial_use": boolean | null,"created_at": string | null,"evidence_url": string | null,"expires_at": string | null,"kind": string | null,"license": string | null,"license_status": Database["public"]['Enums']["license_status"] | null,"notes": string | null,"owner": string | null,"ownership": Database["public"]['Enums']["asset_ownership"] | null,"project_id": string | null,"publisher": string | null,"rights_status": Database["public"]['Enums']["rights_status"] | null,"risk": string | null,"source_detail": string | null,"title": string | null,"transformation_required": boolean | null,"url": string | null,"usable_in_production": boolean | null
                  }
                  ComputedFields: never
                  Relationships: [
                    
                  ]
                },"content_latest_metrics": {
                  Row: {
                    "avg_percentage_viewed": number | null,"captured_at": string | null,"comments": number | null,"content_item_id": string | null,"ctr": number | null,"likes": number | null,"platform": Database["public"]['Enums']["platform"] | null,"project_id": string | null,"shares": number | null,"subscribers_gained": number | null,"views": number | null,"watch_time_sec": number | null
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "analytics_content_item_id_project_id_fkey"
      columns: ["content_item_id","project_id"]
isOneToOne: false
      referencedRelation: "content_items"
      referencedColumns: ["id","project_id"]
    },{
      foreignKeyName: "analytics_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Functions: {
            "ai_usage_summary":
{ Args: { "p_days"?: number,"p_project_id": string }; Returns: {
              "cache_read_tokens": number,"cache_write_tokens": number,"calls": number,"cost_usd": number,"errors": number,"input_tokens": number,"model": string,"output_tokens": number,"provider": string,"task": Database["public"]['Enums']["ai_task"],"unpriced_calls": number
            }[]
                           },
"cancel_job":
{ Args: { "p_job_id": string }; Returns: {
              "attempts": number,
"created_at": string,
"created_by": string | null,
"error_message": string | null,
"finished_at": string | null,
"id": string,
"idempotency_key": string | null,
"locked_at": string | null,
"locked_by": string | null,
"max_attempts": number,
"payload": NonNullable<Json>,
"priority": number,
"project_id": string | null,
"result": Json | null,
"run_after": string,
"started_at": string | null,
"status": Database["public"]['Enums']["job_status"],
"type": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "jobs"
        isOneToOne: true
        isSetofReturn: false
      } },
"claim_jobs":
{ Args: { "p_limit"?: number,"p_types"?: (string)[],"p_worker": string }; Returns: {
              "attempts": number,
"created_at": string,
"created_by": string | null,
"error_message": string | null,
"finished_at": string | null,
"id": string,
"idempotency_key": string | null,
"locked_at": string | null,
"locked_by": string | null,
"max_attempts": number,
"payload": NonNullable<Json>,
"priority": number,
"project_id": string | null,
"result": Json | null,
"run_after": string,
"started_at": string | null,
"status": Database["public"]['Enums']["job_status"],
"type": string,
"updated_at": string
            }[]
                          SetofOptions: {
        from: "*"
        to: "jobs"
        isOneToOne: false
        isSetofReturn: true
      } },
"complete_job":
{ Args: { "p_job_id": string,"p_result"?: Json }; Returns: {
              "attempts": number,
"created_at": string,
"created_by": string | null,
"error_message": string | null,
"finished_at": string | null,
"id": string,
"idempotency_key": string | null,
"locked_at": string | null,
"locked_by": string | null,
"max_attempts": number,
"payload": NonNullable<Json>,
"priority": number,
"project_id": string | null,
"result": Json | null,
"run_after": string,
"started_at": string | null,
"status": Database["public"]['Enums']["job_status"],
"type": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "jobs"
        isOneToOne: true
        isSetofReturn: false
      } },
"content_item_blockers":
{ Args: { "p_content_item_id": string }; Returns: (string)[]
                           },
"content_items_blockers":
{ Args: { "p_ids": (string)[],"p_project_id": string }; Returns: {
              "blockers": (string)[],"content_item_id": string
            }[]
                           },
"create_story_for_content_item":
{ Args: { "p_content_item_id": string }; Returns: {
              "existing": boolean,"story_id": string
            }[]
                           },
"fail_job":
{ Args: { "p_error": string,"p_job_id": string,"p_retry"?: boolean }; Returns: {
              "attempts": number,
"created_at": string,
"created_by": string | null,
"error_message": string | null,
"finished_at": string | null,
"id": string,
"idempotency_key": string | null,
"locked_at": string | null,
"locked_by": string | null,
"max_attempts": number,
"payload": NonNullable<Json>,
"priority": number,
"project_id": string | null,
"result": Json | null,
"run_after": string,
"started_at": string | null,
"status": Database["public"]['Enums']["job_status"],
"type": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "jobs"
        isOneToOne: true
        isSetofReturn: false
      } },
"get_dashboard":
{ Args: { "p_project_id": string }; Returns: Json
                           },
"record_approval":
{ Args: { "p_checkpoint": Database["public"]['Enums']["approval_checkpoint"],"p_decision": Database["public"]['Enums']["approval_decision"],"p_entity_id": string,"p_notes"?: string }; Returns: {
              "checkpoint": Database["public"]['Enums']["approval_checkpoint"],
"created_at": string,
"decided_by": string,
"decision": Database["public"]['Enums']["approval_decision"],
"entity_id": string,
"entity_type": string,
"id": string,
"notes": string | null,
"project_id": string,
"seq": number
            }
                          SetofOptions: {
        from: "*"
        to: "approvals"
        isOneToOne: true
        isSetofReturn: false
      } },
"requeue_stale_jobs":
{ Args: { "p_timeout"?: string }; Returns: number
                           },
"start_production":
{ Args: { "p_opportunity_id": string }; Returns: {
              "content_item_id": string,"existing": boolean,"story_id": string
            }[]
                           }
          }
          Enums: {
            "actor_type": "user"|"agent"|"system","agent_key": "orchestrator"|"sports_radar"|"trend_hunter"|"researcher"|"fact_checker"|"rights"|"story"|"hook"|"editor"|"thumbnail"|"publisher"|"analytics"|"ceo","ai_task": "discovery"|"scoring"|"research"|"script"|"fact_check","app_role": "member"|"admin"|"owner","approval_checkpoint": "opportunity"|"story"|"production"|"publishing"|"script"|"rights","approval_decision": "approved"|"rejected","asset_ownership": "owned"|"licensed"|"authorized"|"creator_provided"|"public_domain"|"third_party"|"unknown","caption_format": "srt"|"ass","caption_preset": "clean"|"bold"|"creator","claim_relation": "supports"|"contradicts"|"mentions","clip_status": "candidate"|"approved"|"rejected"|"rendering"|"rendered"|"failed","competition_level": "low"|"medium"|"high","connection_status": "not_connected"|"connected"|"expired"|"error","connector_kind": "rss"|"json_api","content_format": "short"|"long"|"post","content_stage": "idea"|"research"|"script"|"production"|"review"|"ready"|"scheduled"|"published"|"analyzing","editorial_format": "original_commentary"|"voiceover"|"statistics"|"graphics"|"timeline"|"animation"|"map"|"original_visuals"|"authorized_footage"|"licensed_footage"|"screenshots"|"public_sources"|"creator_provided","event_status": "scheduled"|"live"|"finished"|"postponed"|"cancelled","fact_status": "confirmed"|"probable"|"uncertain"|"false","hook_type": "curiosity"|"controversial"|"shock"|"mystery"|"story"|"statistical","job_status": "pending"|"running"|"completed"|"failed"|"cancelled","license_status": "unknown"|"owned"|"licensed"|"public_domain"|"creative_commons"|"fair_use_review"|"restricted","log_status": "info"|"success"|"warning"|"failed","member_role": "viewer"|"editor"|"admin"|"owner","opportunity_status": "new"|"researching"|"approved"|"rejected"|"production"|"ready"|"published"|"archived","platform": "youtube"|"tiktok"|"instagram","project_status": "active"|"paused"|"archived","publish_mode": "manual_export"|"api","radar_signal": "upcoming_event"|"just_finished"|"breaking"|"upset"|"record"|"rivalry"|"controversy"|"statement"|"unusual_stat"|"injury"|"transfer"|"rising_trend","reframe_mode": "speaker"|"face"|"subject"|"center","research_item_type": "article"|"video"|"quote"|"timeline"|"note"|"question"|"context"|"media"|"competitor","rights_status": "unchecked"|"green"|"yellow"|"red","run_trigger": "manual"|"schedule"|"orchestrator"|"event","script_angle": "breaking_news"|"storytelling"|"analysis"|"controversy"|"unexpected_fact","script_operation": "generate"|"regenerate"|"shorten"|"expand"|"rewrite_hook"|"change_tone"|"manual","segment_type": "transcript"|"scene"|"candidate","source_type": "news"|"rss"|"api"|"social"|"video"|"official"|"press_release"|"other","story_status": "draft"|"review"|"approved"|"rejected","task_status": "pending"|"running"|"waiting_approval"|"completed"|"failed"|"cancelled","thumbnail_status": "concept"|"selected"|"generated"|"rejected","trend_status": "emerging"|"rising"|"peaking"|"declining"|"expired","video_status": "uploaded"|"processing"|"analyzed"|"failed"
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
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            "actor_type": ["user", "agent", "system"],"agent_key": ["orchestrator", "sports_radar", "trend_hunter", "researcher", "fact_checker", "rights", "story", "hook", "editor", "thumbnail", "publisher", "analytics", "ceo"],"ai_task": ["discovery", "scoring", "research", "script", "fact_check"],"app_role": ["member", "admin", "owner"],"approval_checkpoint": ["opportunity", "story", "production", "publishing", "script", "rights"],"approval_decision": ["approved", "rejected"],"asset_ownership": ["owned", "licensed", "authorized", "creator_provided", "public_domain", "third_party", "unknown"],"caption_format": ["srt", "ass"],"caption_preset": ["clean", "bold", "creator"],"claim_relation": ["supports", "contradicts", "mentions"],"clip_status": ["candidate", "approved", "rejected", "rendering", "rendered", "failed"],"competition_level": ["low", "medium", "high"],"connection_status": ["not_connected", "connected", "expired", "error"],"connector_kind": ["rss", "json_api"],"content_format": ["short", "long", "post"],"content_stage": ["idea", "research", "script", "production", "review", "ready", "scheduled", "published", "analyzing"],"editorial_format": ["original_commentary", "voiceover", "statistics", "graphics", "timeline", "animation", "map", "original_visuals", "authorized_footage", "licensed_footage", "screenshots", "public_sources", "creator_provided"],"event_status": ["scheduled", "live", "finished", "postponed", "cancelled"],"fact_status": ["confirmed", "probable", "uncertain", "false"],"hook_type": ["curiosity", "controversial", "shock", "mystery", "story", "statistical"],"job_status": ["pending", "running", "completed", "failed", "cancelled"],"license_status": ["unknown", "owned", "licensed", "public_domain", "creative_commons", "fair_use_review", "restricted"],"log_status": ["info", "success", "warning", "failed"],"member_role": ["viewer", "editor", "admin", "owner"],"opportunity_status": ["new", "researching", "approved", "rejected", "production", "ready", "published", "archived"],"platform": ["youtube", "tiktok", "instagram"],"project_status": ["active", "paused", "archived"],"publish_mode": ["manual_export", "api"],"radar_signal": ["upcoming_event", "just_finished", "breaking", "upset", "record", "rivalry", "controversy", "statement", "unusual_stat", "injury", "transfer", "rising_trend"],"reframe_mode": ["speaker", "face", "subject", "center"],"research_item_type": ["article", "video", "quote", "timeline", "note", "question", "context", "media", "competitor"],"rights_status": ["unchecked", "green", "yellow", "red"],"run_trigger": ["manual", "schedule", "orchestrator", "event"],"script_angle": ["breaking_news", "storytelling", "analysis", "controversy", "unexpected_fact"],"script_operation": ["generate", "regenerate", "shorten", "expand", "rewrite_hook", "change_tone", "manual"],"segment_type": ["transcript", "scene", "candidate"],"source_type": ["news", "rss", "api", "social", "video", "official", "press_release", "other"],"story_status": ["draft", "review", "approved", "rejected"],"task_status": ["pending", "running", "waiting_approval", "completed", "failed", "cancelled"],"thumbnail_status": ["concept", "selected", "generated", "rejected"],"trend_status": ["emerging", "rising", "peaking", "declining", "expired"],"video_status": ["uploaded", "processing", "analyzed", "failed"]
          }
        }
} as const
