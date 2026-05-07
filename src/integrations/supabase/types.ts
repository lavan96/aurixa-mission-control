export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      ai_usage_log: {
        Row: {
          completion_tokens: number | null
          cost_estimate_usd: number | null
          created_at: string
          feature: string
          id: string
          metadata: Json
          model: string
          prompt_tokens: number | null
          total_tokens: number | null
          user_id: string | null
        }
        Insert: {
          completion_tokens?: number | null
          cost_estimate_usd?: number | null
          created_at?: string
          feature: string
          id?: string
          metadata?: Json
          model: string
          prompt_tokens?: number | null
          total_tokens?: number | null
          user_id?: string | null
        }
        Update: {
          completion_tokens?: number | null
          cost_estimate_usd?: number | null
          created_at?: string
          feature?: string
          id?: string
          metadata?: Json
          model?: string
          prompt_tokens?: number | null
          total_tokens?: number | null
          user_id?: string | null
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          action: string
          actor_user_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: string
          metadata: Json
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          metadata?: Json
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          metadata?: Json
        }
        Relationships: []
      }
      cascade_approvals: {
        Row: {
          approver_user_id: string
          cascade_event_id: string
          created_at: string
          decision: string
          id: string
          reason: string | null
        }
        Insert: {
          approver_user_id: string
          cascade_event_id: string
          created_at?: string
          decision: string
          id?: string
          reason?: string | null
        }
        Update: {
          approver_user_id?: string
          cascade_event_id?: string
          created_at?: string
          decision?: string
          id?: string
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cascade_approvals_cascade_event_id_fkey"
            columns: ["cascade_event_id"]
            isOneToOne: false
            referencedRelation: "cascade_events"
            referencedColumns: ["id"]
          },
        ]
      }
      cascade_events: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          completed_at: string | null
          created_at: string
          id: string
          initiated_by: string | null
          mode: Database["public"]["Enums"]["cascade_mode"]
          requires_approval: boolean
          scope_filter: Json
          source_branch: string | null
          source_sha: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["cascade_event_status"]
          summary: string | null
          trigger: Database["public"]["Enums"]["cascade_trigger"]
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          completed_at?: string | null
          created_at?: string
          id?: string
          initiated_by?: string | null
          mode: Database["public"]["Enums"]["cascade_mode"]
          requires_approval?: boolean
          scope_filter?: Json
          source_branch?: string | null
          source_sha?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["cascade_event_status"]
          summary?: string | null
          trigger: Database["public"]["Enums"]["cascade_trigger"]
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          completed_at?: string | null
          created_at?: string
          id?: string
          initiated_by?: string | null
          mode?: Database["public"]["Enums"]["cascade_mode"]
          requires_approval?: boolean
          scope_filter?: Json
          source_branch?: string | null
          source_sha?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["cascade_event_status"]
          summary?: string | null
          trigger?: Database["public"]["Enums"]["cascade_trigger"]
          updated_at?: string
        }
        Relationships: []
      }
      cascade_results: {
        Row: {
          cascade_event_id: string
          clone_id: string
          commit_sha: string | null
          completed_at: string | null
          created_at: string
          diff_summary: string | null
          error_message: string | null
          files_changed: number
          id: string
          pr_url: string | null
          previous_sha: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["cascade_result_status"]
          updated_at: string
        }
        Insert: {
          cascade_event_id: string
          clone_id: string
          commit_sha?: string | null
          completed_at?: string | null
          created_at?: string
          diff_summary?: string | null
          error_message?: string | null
          files_changed?: number
          id?: string
          pr_url?: string | null
          previous_sha?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["cascade_result_status"]
          updated_at?: string
        }
        Update: {
          cascade_event_id?: string
          clone_id?: string
          commit_sha?: string | null
          completed_at?: string | null
          created_at?: string
          diff_summary?: string | null
          error_message?: string | null
          files_changed?: number
          id?: string
          pr_url?: string | null
          previous_sha?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["cascade_result_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cascade_results_cascade_event_id_fkey"
            columns: ["cascade_event_id"]
            isOneToOne: false
            referencedRelation: "cascade_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cascade_results_clone_id_fkey"
            columns: ["clone_id"]
            isOneToOne: false
            referencedRelation: "clones"
            referencedColumns: ["id"]
          },
        ]
      }
      cascade_schedules: {
        Row: {
          created_at: string
          created_by: string | null
          cron_expression: string
          enabled: boolean
          id: string
          kind: Database["public"]["Enums"]["cascade_schedule_kind"]
          last_cascade_event_id: string | null
          last_run_at: string | null
          mode: Database["public"]["Enums"]["cascade_mode"]
          name: string
          next_run_at: string | null
          notes: string | null
          scope_filter: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          cron_expression: string
          enabled?: boolean
          id?: string
          kind: Database["public"]["Enums"]["cascade_schedule_kind"]
          last_cascade_event_id?: string | null
          last_run_at?: string | null
          mode?: Database["public"]["Enums"]["cascade_mode"]
          name: string
          next_run_at?: string | null
          notes?: string | null
          scope_filter?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          cron_expression?: string
          enabled?: boolean
          id?: string
          kind?: Database["public"]["Enums"]["cascade_schedule_kind"]
          last_cascade_event_id?: string | null
          last_run_at?: string | null
          mode?: Database["public"]["Enums"]["cascade_mode"]
          name?: string
          next_run_at?: string | null
          notes?: string | null
          scope_filter?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cascade_schedules_last_cascade_event_id_fkey"
            columns: ["last_cascade_event_id"]
            isOneToOne: false
            referencedRelation: "cascade_events"
            referencedColumns: ["id"]
          },
        ]
      }
      cascade_templates: {
        Row: {
          clone_ids: string[]
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          last_used_at: string | null
          mode: Database["public"]["Enums"]["cascade_mode"]
          name: string
          scope: string
          tags: string[]
          updated_at: string
          use_count: number
        }
        Insert: {
          clone_ids?: string[]
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          last_used_at?: string | null
          mode?: Database["public"]["Enums"]["cascade_mode"]
          name: string
          scope?: string
          tags?: string[]
          updated_at?: string
          use_count?: number
        }
        Update: {
          clone_ids?: string[]
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          last_used_at?: string | null
          mode?: Database["public"]["Enums"]["cascade_mode"]
          name?: string
          scope?: string
          tags?: string[]
          updated_at?: string
          use_count?: number
        }
        Relationships: []
      }
      clone_backends: {
        Row: {
          admin_email: string | null
          anon_key: string | null
          clone_id: string
          created_at: string
          db_pass: string | null
          error_message: string | null
          id: string
          migration_version: string | null
          region: string
          service_role_key: string | null
          status: Database["public"]["Enums"]["clone_backend_status"]
          status_detail: string | null
          supabase_project_ref: string | null
          supabase_url: string | null
          updated_at: string
        }
        Insert: {
          admin_email?: string | null
          anon_key?: string | null
          clone_id: string
          created_at?: string
          db_pass?: string | null
          error_message?: string | null
          id?: string
          migration_version?: string | null
          region?: string
          service_role_key?: string | null
          status?: Database["public"]["Enums"]["clone_backend_status"]
          status_detail?: string | null
          supabase_project_ref?: string | null
          supabase_url?: string | null
          updated_at?: string
        }
        Update: {
          admin_email?: string | null
          anon_key?: string | null
          clone_id?: string
          created_at?: string
          db_pass?: string | null
          error_message?: string | null
          id?: string
          migration_version?: string | null
          region?: string
          service_role_key?: string | null
          status?: Database["public"]["Enums"]["clone_backend_status"]
          status_detail?: string | null
          supabase_project_ref?: string | null
          supabase_url?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      clone_brand_asset_variants: {
        Row: {
          byte_size: number | null
          content_type: string
          generated_at: string
          height: number | null
          id: string
          profile_id: string
          public_url: string
          source_path: string
          variant_kind: string
          variant_path: string
          width: number | null
        }
        Insert: {
          byte_size?: number | null
          content_type: string
          generated_at?: string
          height?: number | null
          id?: string
          profile_id: string
          public_url: string
          source_path: string
          variant_kind: string
          variant_path: string
          width?: number | null
        }
        Update: {
          byte_size?: number | null
          content_type?: string
          generated_at?: string
          height?: number | null
          id?: string
          profile_id?: string
          public_url?: string
          source_path?: string
          variant_kind?: string
          variant_path?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "clone_brand_asset_variants_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "clone_brand_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      clone_brand_assignments: {
        Row: {
          applied_at: string | null
          applied_by: string | null
          applied_config_hash: string | null
          clone_id: string
          created_at: string
          drift_summary: string | null
          error_message: string | null
          id: string
          last_drift_check_at: string | null
          override_keys: string[]
          overrides: Json
          profile_id: string
          status: Database["public"]["Enums"]["brand_assignment_status"]
          updated_at: string
        }
        Insert: {
          applied_at?: string | null
          applied_by?: string | null
          applied_config_hash?: string | null
          clone_id: string
          created_at?: string
          drift_summary?: string | null
          error_message?: string | null
          id?: string
          last_drift_check_at?: string | null
          override_keys?: string[]
          overrides?: Json
          profile_id: string
          status?: Database["public"]["Enums"]["brand_assignment_status"]
          updated_at?: string
        }
        Update: {
          applied_at?: string | null
          applied_by?: string | null
          applied_config_hash?: string | null
          clone_id?: string
          created_at?: string
          drift_summary?: string | null
          error_message?: string | null
          id?: string
          last_drift_check_at?: string | null
          override_keys?: string[]
          overrides?: Json
          profile_id?: string
          status?: Database["public"]["Enums"]["brand_assignment_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clone_brand_assignments_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "clone_brand_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      clone_brand_history: {
        Row: {
          cascade_event_id: string | null
          clone_id: string
          config_hash: string | null
          config_snapshot: Json
          created_at: string
          duration_ms: number | null
          error_message: string | null
          id: string
          profile_id: string | null
          profile_version: number | null
          pushed_by: string | null
          status: Database["public"]["Enums"]["brand_assignment_status"]
        }
        Insert: {
          cascade_event_id?: string | null
          clone_id: string
          config_hash?: string | null
          config_snapshot?: Json
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          id?: string
          profile_id?: string | null
          profile_version?: number | null
          pushed_by?: string | null
          status?: Database["public"]["Enums"]["brand_assignment_status"]
        }
        Update: {
          cascade_event_id?: string | null
          clone_id?: string
          config_hash?: string | null
          config_snapshot?: Json
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          id?: string
          profile_id?: string | null
          profile_version?: number | null
          pushed_by?: string | null
          status?: Database["public"]["Enums"]["brand_assignment_status"]
        }
        Relationships: []
      }
      clone_brand_profiles: {
        Row: {
          asset_manifest: Json
          brand_config: Json
          config_hash: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_default: boolean
          name: string
          published_at: string | null
          published_by: string | null
          published_version_id: string | null
          report_contact: Json
          slug: string
          status: Database["public"]["Enums"]["brand_profile_status"]
          tags: string[]
          updated_at: string
          version: number
        }
        Insert: {
          asset_manifest?: Json
          brand_config?: Json
          config_hash?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_default?: boolean
          name: string
          published_at?: string | null
          published_by?: string | null
          published_version_id?: string | null
          report_contact?: Json
          slug: string
          status?: Database["public"]["Enums"]["brand_profile_status"]
          tags?: string[]
          updated_at?: string
          version?: number
        }
        Update: {
          asset_manifest?: Json
          brand_config?: Json
          config_hash?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_default?: boolean
          name?: string
          published_at?: string | null
          published_by?: string | null
          published_version_id?: string | null
          report_contact?: Json
          slug?: string
          status?: Database["public"]["Enums"]["brand_profile_status"]
          tags?: string[]
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "clone_brand_profiles_published_version_id_fkey"
            columns: ["published_version_id"]
            isOneToOne: false
            referencedRelation: "clone_brand_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      clone_brand_versions: {
        Row: {
          asset_manifest: Json
          brand_config: Json
          config_hash: string | null
          created_at: string
          id: string
          notes: string | null
          profile_id: string
          published_at: string
          published_by: string | null
          report_contact: Json
          version: number
        }
        Insert: {
          asset_manifest?: Json
          brand_config?: Json
          config_hash?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          profile_id: string
          published_at?: string
          published_by?: string | null
          report_contact?: Json
          version: number
        }
        Update: {
          asset_manifest?: Json
          brand_config?: Json
          config_hash?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          profile_id?: string
          published_at?: string
          published_by?: string | null
          report_contact?: Json
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "clone_brand_versions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "clone_brand_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      clone_drift_policies: {
        Row: {
          auto_apply_severity: Database["public"]["Enums"]["drift_severity"]
          cascade_mode: Database["public"]["Enums"]["cascade_mode"]
          clone_id: string
          created_at: string
          enabled: boolean
          id: string
          last_applied_at: string | null
          last_applied_count: number
          max_per_run: number
          muted_kinds: string[]
          updated_at: string
        }
        Insert: {
          auto_apply_severity?: Database["public"]["Enums"]["drift_severity"]
          cascade_mode?: Database["public"]["Enums"]["cascade_mode"]
          clone_id: string
          created_at?: string
          enabled?: boolean
          id?: string
          last_applied_at?: string | null
          last_applied_count?: number
          max_per_run?: number
          muted_kinds?: string[]
          updated_at?: string
        }
        Update: {
          auto_apply_severity?: Database["public"]["Enums"]["drift_severity"]
          cascade_mode?: Database["public"]["Enums"]["cascade_mode"]
          clone_id?: string
          created_at?: string
          enabled?: boolean
          id?: string
          last_applied_at?: string | null
          last_applied_count?: number
          max_per_run?: number
          muted_kinds?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clone_drift_policies_clone_id_fkey"
            columns: ["clone_id"]
            isOneToOne: true
            referencedRelation: "clones"
            referencedColumns: ["id"]
          },
        ]
      }
      clone_health_snapshots: {
        Row: {
          clone_id: string
          created_at: string
          id: string
          payload: Json
          probed_at: string
          updated_at: string
        }
        Insert: {
          clone_id: string
          created_at?: string
          id?: string
          payload: Json
          probed_at?: string
          updated_at?: string
        }
        Update: {
          clone_id?: string
          created_at?: string
          id?: string
          payload?: Json
          probed_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clone_health_snapshots_clone_id_fkey"
            columns: ["clone_id"]
            isOneToOne: true
            referencedRelation: "clones"
            referencedColumns: ["id"]
          },
        ]
      }
      clone_library_pins: {
        Row: {
          clone_id: string
          created_at: string
          id: string
          library_entry_id: string
          notes: string | null
          pinned_at: string
          pinned_by: string | null
          slug: string
          updated_at: string
          version: number
        }
        Insert: {
          clone_id: string
          created_at?: string
          id?: string
          library_entry_id: string
          notes?: string | null
          pinned_at?: string
          pinned_by?: string | null
          slug: string
          updated_at?: string
          version: number
        }
        Update: {
          clone_id?: string
          created_at?: string
          id?: string
          library_entry_id?: string
          notes?: string | null
          pinned_at?: string
          pinned_by?: string | null
          slug?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      clone_modules: {
        Row: {
          clone_id: string
          id: string
          installed_at: string
          installed_by: string | null
          module_id: string
          version: string | null
        }
        Insert: {
          clone_id: string
          id?: string
          installed_at?: string
          installed_by?: string | null
          module_id: string
          version?: string | null
        }
        Update: {
          clone_id?: string
          id?: string
          installed_at?: string
          installed_by?: string | null
          module_id?: string
          version?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clone_modules_clone_id_fkey"
            columns: ["clone_id"]
            isOneToOne: false
            referencedRelation: "clones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clone_modules_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "modules"
            referencedColumns: ["id"]
          },
        ]
      }
      clones: {
        Row: {
          cloudflare_enabled: boolean
          cloudflare_zone_id: string | null
          commits_behind: number
          created_at: string
          default_branch: string
          deploy_url: string | null
          drift_suggestions: Json
          github_owner: string
          github_repo: string
          github_url: string | null
          id: string
          last_cascade_at: string | null
          last_drift_check_at: string | null
          last_synced_sha: string | null
          lovable_project_id: string | null
          lovable_project_url: string | null
          name: string
          notes: string | null
          owner_user_id: string | null
          provisioning_method: Database["public"]["Enums"]["provisioning_method"]
          slug: string
          sync_status: Database["public"]["Enums"]["sync_status"]
          tags: string[] | null
          updated_at: string
        }
        Insert: {
          cloudflare_enabled?: boolean
          cloudflare_zone_id?: string | null
          commits_behind?: number
          created_at?: string
          default_branch?: string
          deploy_url?: string | null
          drift_suggestions?: Json
          github_owner: string
          github_repo: string
          github_url?: string | null
          id?: string
          last_cascade_at?: string | null
          last_drift_check_at?: string | null
          last_synced_sha?: string | null
          lovable_project_id?: string | null
          lovable_project_url?: string | null
          name: string
          notes?: string | null
          owner_user_id?: string | null
          provisioning_method: Database["public"]["Enums"]["provisioning_method"]
          slug: string
          sync_status?: Database["public"]["Enums"]["sync_status"]
          tags?: string[] | null
          updated_at?: string
        }
        Update: {
          cloudflare_enabled?: boolean
          cloudflare_zone_id?: string | null
          commits_behind?: number
          created_at?: string
          default_branch?: string
          deploy_url?: string | null
          drift_suggestions?: Json
          github_owner?: string
          github_repo?: string
          github_url?: string | null
          id?: string
          last_cascade_at?: string | null
          last_drift_check_at?: string | null
          last_synced_sha?: string | null
          lovable_project_id?: string | null
          lovable_project_url?: string | null
          name?: string
          notes?: string | null
          owner_user_id?: string | null
          provisioning_method?: Database["public"]["Enums"]["provisioning_method"]
          slug?: string
          sync_status?: Database["public"]["Enums"]["sync_status"]
          tags?: string[] | null
          updated_at?: string
        }
        Relationships: []
      }
      cloudflare_accounts: {
        Row: {
          account_id: string
          account_name: string | null
          created_at: string
          created_by: string | null
          email: string | null
          id: string
          is_active: boolean
          token_secret_name: string
          updated_at: string
        }
        Insert: {
          account_id: string
          account_name?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          is_active?: boolean
          token_secret_name?: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          account_name?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          is_active?: boolean
          token_secret_name?: string
          updated_at?: string
        }
        Relationships: []
      }
      cloudflare_audit: {
        Row: {
          action: string
          actor_user_id: string | null
          clone_id: string | null
          created_at: string
          error_message: string | null
          id: string
          payload: Json
          result: Json
          success: boolean
          zone_id: string | null
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          clone_id?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          payload?: Json
          result?: Json
          success?: boolean
          zone_id?: string | null
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          clone_id?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          payload?: Json
          result?: Json
          success?: boolean
          zone_id?: string | null
        }
        Relationships: []
      }
      cloudflare_clone_config: {
        Row: {
          account_id: string
          bot_fight_mode: boolean
          clone_id: string
          created_at: string
          id: string
          last_synced_at: string | null
          plan: string | null
          posture: Json
          rate_limit_rps: number | null
          security_level: string | null
          status: string
          updated_at: string
          waf_preset: string | null
          zone_id: string
          zone_name: string
        }
        Insert: {
          account_id: string
          bot_fight_mode?: boolean
          clone_id: string
          created_at?: string
          id?: string
          last_synced_at?: string | null
          plan?: string | null
          posture?: Json
          rate_limit_rps?: number | null
          security_level?: string | null
          status?: string
          updated_at?: string
          waf_preset?: string | null
          zone_id: string
          zone_name: string
        }
        Update: {
          account_id?: string
          bot_fight_mode?: boolean
          clone_id?: string
          created_at?: string
          id?: string
          last_synced_at?: string | null
          plan?: string | null
          posture?: Json
          rate_limit_rps?: number | null
          security_level?: string | null
          status?: string
          updated_at?: string
          waf_preset?: string | null
          zone_id?: string
          zone_name?: string
        }
        Relationships: []
      }
      fleet_digests: {
        Row: {
          created_at: string
          generated_by_model: string | null
          id: string
          metrics: Json
          period_end: string
          period_start: string
          summary_markdown: string
        }
        Insert: {
          created_at?: string
          generated_by_model?: string | null
          id?: string
          metrics?: Json
          period_end: string
          period_start: string
          summary_markdown: string
        }
        Update: {
          created_at?: string
          generated_by_model?: string | null
          id?: string
          metrics?: Json
          period_end?: string
          period_start?: string
          summary_markdown?: string
        }
        Relationships: []
      }
      module_cascade_jobs: {
        Row: {
          cascade_event_id: string | null
          clone_ids: string[]
          completed_at: string | null
          created_at: string
          error_message: string | null
          id: string
          initiated_by: string | null
          metadata: Json
          module_ids: string[]
          status: string
          updated_at: string
        }
        Insert: {
          cascade_event_id?: string | null
          clone_ids?: string[]
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          initiated_by?: string | null
          metadata?: Json
          module_ids?: string[]
          status?: string
          updated_at?: string
        }
        Update: {
          cascade_event_id?: string | null
          clone_ids?: string[]
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          initiated_by?: string | null
          metadata?: Json
          module_ids?: string[]
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      module_config_snapshots: {
        Row: {
          clone_id: string
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          label: string
          module_ids: string[]
        }
        Insert: {
          clone_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          label?: string
          module_ids?: string[]
        }
        Update: {
          clone_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          label?: string
          module_ids?: string[]
        }
        Relationships: []
      }
      module_detection_runs: {
        Row: {
          completed_at: string | null
          created_at: string
          delta_mode: boolean | null
          dependency_count: number | null
          error_message: string | null
          file_count: number | null
          id: string
          initiated_by: string | null
          inserted_modules: number | null
          orphan_files_found: number | null
          parameters: Json | null
          pass_count: number | null
          passes: Json | null
          previous_run_id: string | null
          proposed_modules: number | null
          sampled_file_count: number | null
          started_at: string | null
          status: string
          strategy: string
          tree_hash: string | null
          updated_at: string
          updated_modules: number | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          delta_mode?: boolean | null
          dependency_count?: number | null
          error_message?: string | null
          file_count?: number | null
          id?: string
          initiated_by?: string | null
          inserted_modules?: number | null
          orphan_files_found?: number | null
          parameters?: Json | null
          pass_count?: number | null
          passes?: Json | null
          previous_run_id?: string | null
          proposed_modules?: number | null
          sampled_file_count?: number | null
          started_at?: string | null
          status?: string
          strategy?: string
          tree_hash?: string | null
          updated_at?: string
          updated_modules?: number | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          delta_mode?: boolean | null
          dependency_count?: number | null
          error_message?: string | null
          file_count?: number | null
          id?: string
          initiated_by?: string | null
          inserted_modules?: number | null
          orphan_files_found?: number | null
          parameters?: Json | null
          pass_count?: number | null
          passes?: Json | null
          previous_run_id?: string | null
          proposed_modules?: number | null
          sampled_file_count?: number | null
          started_at?: string | null
          status?: string
          strategy?: string
          tree_hash?: string | null
          updated_at?: string
          updated_modules?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "module_detection_runs_previous_run_id_fkey"
            columns: ["previous_run_id"]
            isOneToOne: false
            referencedRelation: "module_detection_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      module_drift_alerts: {
        Row: {
          alert_type: string
          created_at: string
          detection_run_id: string | null
          file_path: string | null
          id: string
          module_id: string | null
          reasoning: string | null
          resolved: boolean
          resolved_at: string | null
          resolved_by: string | null
          severity: string
          suggested_module_slug: string | null
        }
        Insert: {
          alert_type: string
          created_at?: string
          detection_run_id?: string | null
          file_path?: string | null
          id?: string
          module_id?: string | null
          reasoning?: string | null
          resolved?: boolean
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          suggested_module_slug?: string | null
        }
        Update: {
          alert_type?: string
          created_at?: string
          detection_run_id?: string | null
          file_path?: string | null
          id?: string
          module_id?: string | null
          reasoning?: string | null
          resolved?: boolean
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          suggested_module_slug?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "module_drift_alerts_detection_run_id_fkey"
            columns: ["detection_run_id"]
            isOneToOne: false
            referencedRelation: "module_detection_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "module_drift_alerts_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "modules"
            referencedColumns: ["id"]
          },
        ]
      }
      module_import_edges: {
        Row: {
          created_at: string
          detection_run_id: string
          id: string
          import_type: string
          source_file: string
          target_file: string
        }
        Insert: {
          created_at?: string
          detection_run_id: string
          id?: string
          import_type?: string
          source_file: string
          target_file: string
        }
        Update: {
          created_at?: string
          detection_run_id?: string
          id?: string
          import_type?: string
          source_file?: string
          target_file?: string
        }
        Relationships: [
          {
            foreignKeyName: "module_import_edges_detection_run_id_fkey"
            columns: ["detection_run_id"]
            isOneToOne: false
            referencedRelation: "module_detection_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      module_library: {
        Row: {
          approval_status: string
          approved_at: string | null
          approved_by: string | null
          created_at: string
          deprecated_at: string | null
          deprecated_reason: string | null
          description: string | null
          entry_file: string
          file_count: number
          file_paths: string[]
          id: string
          is_latest: boolean
          metadata: Json
          name: string
          published_at: string
          published_by: string | null
          rejection_reason: string | null
          replacement_slug: string | null
          route_path: string | null
          slug: string
          source_detection_run_id: string | null
          source_module_id: string | null
          tags: string[]
          updated_at: string
          version: number
        }
        Insert: {
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          deprecated_at?: string | null
          deprecated_reason?: string | null
          description?: string | null
          entry_file: string
          file_count?: number
          file_paths?: string[]
          id?: string
          is_latest?: boolean
          metadata?: Json
          name: string
          published_at?: string
          published_by?: string | null
          rejection_reason?: string | null
          replacement_slug?: string | null
          route_path?: string | null
          slug: string
          source_detection_run_id?: string | null
          source_module_id?: string | null
          tags?: string[]
          updated_at?: string
          version?: number
        }
        Update: {
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          deprecated_at?: string | null
          deprecated_reason?: string | null
          description?: string | null
          entry_file?: string
          file_count?: number
          file_paths?: string[]
          id?: string
          is_latest?: boolean
          metadata?: Json
          name?: string
          published_at?: string
          published_by?: string | null
          rejection_reason?: string | null
          replacement_slug?: string | null
          route_path?: string | null
          slug?: string
          source_detection_run_id?: string | null
          source_module_id?: string | null
          tags?: string[]
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      modules: {
        Row: {
          ai_confidence: number | null
          ai_reasoning: string | null
          approved_at: string | null
          approved_by: string | null
          cohesion_score: number | null
          coupling_score: number | null
          created_at: string
          dependencies: string[]
          description: string | null
          detected_by_ai: boolean
          detection_run_id: string | null
          file_globs: string[]
          id: string
          incompatible_with: string[]
          name: string
          orphan_file_count: number | null
          rejection_reason: string | null
          requires: string[]
          resolved_files: string[]
          route_entry_file: string | null
          routes: string[]
          shared_by_modules: string[]
          slug: string
          status: Database["public"]["Enums"]["module_status"]
          tree_snapshot_hash: string | null
          updated_at: string
        }
        Insert: {
          ai_confidence?: number | null
          ai_reasoning?: string | null
          approved_at?: string | null
          approved_by?: string | null
          cohesion_score?: number | null
          coupling_score?: number | null
          created_at?: string
          dependencies?: string[]
          description?: string | null
          detected_by_ai?: boolean
          detection_run_id?: string | null
          file_globs?: string[]
          id?: string
          incompatible_with?: string[]
          name: string
          orphan_file_count?: number | null
          rejection_reason?: string | null
          requires?: string[]
          resolved_files?: string[]
          route_entry_file?: string | null
          routes?: string[]
          shared_by_modules?: string[]
          slug: string
          status?: Database["public"]["Enums"]["module_status"]
          tree_snapshot_hash?: string | null
          updated_at?: string
        }
        Update: {
          ai_confidence?: number | null
          ai_reasoning?: string | null
          approved_at?: string | null
          approved_by?: string | null
          cohesion_score?: number | null
          coupling_score?: number | null
          created_at?: string
          dependencies?: string[]
          description?: string | null
          detected_by_ai?: boolean
          detection_run_id?: string | null
          file_globs?: string[]
          id?: string
          incompatible_with?: string[]
          name?: string
          orphan_file_count?: number | null
          rejection_reason?: string | null
          requires?: string[]
          resolved_files?: string[]
          route_entry_file?: string | null
          routes?: string[]
          shared_by_modules?: string[]
          slug?: string
          status?: Database["public"]["Enums"]["module_status"]
          tree_snapshot_hash?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "modules_detection_run_id_fkey"
            columns: ["detection_run_id"]
            isOneToOne: false
            referencedRelation: "module_detection_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          created_at: string
          digest_mode: string
          id: string
          mute_browser_push: boolean
          mute_toasts: boolean
          muted_kinds: Database["public"]["Enums"]["notification_kind"][]
          muted_severities: Database["public"]["Enums"]["notification_severity"][]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          digest_mode?: string
          id?: string
          mute_browser_push?: boolean
          mute_toasts?: boolean
          muted_kinds?: Database["public"]["Enums"]["notification_kind"][]
          muted_severities?: Database["public"]["Enums"]["notification_severity"][]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          digest_mode?: string
          id?: string
          mute_browser_push?: boolean
          mute_toasts?: boolean
          muted_kinds?: Database["public"]["Enums"]["notification_kind"][]
          muted_severities?: Database["public"]["Enums"]["notification_severity"][]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string | null
          cascade_event_id: string | null
          clone_id: string | null
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["notification_kind"]
          metadata: Json
          read_at: string | null
          severity: Database["public"]["Enums"]["notification_severity"]
          title: string
          url: string | null
        }
        Insert: {
          body?: string | null
          cascade_event_id?: string | null
          clone_id?: string | null
          created_at?: string
          id?: string
          kind: Database["public"]["Enums"]["notification_kind"]
          metadata?: Json
          read_at?: string | null
          severity?: Database["public"]["Enums"]["notification_severity"]
          title: string
          url?: string | null
        }
        Update: {
          body?: string | null
          cascade_event_id?: string | null
          clone_id?: string | null
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["notification_kind"]
          metadata?: Json
          read_at?: string | null
          severity?: Database["public"]["Enums"]["notification_severity"]
          title?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_cascade_event_id_fkey"
            columns: ["cascade_event_id"]
            isOneToOne: false
            referencedRelation: "cascade_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_clone_id_fkey"
            columns: ["clone_id"]
            isOneToOne: false
            referencedRelation: "clones"
            referencedColumns: ["id"]
          },
        ]
      }
      prime_config: {
        Row: {
          created_at: string
          default_branch: string
          default_cascade_mode: Database["public"]["Enums"]["cascade_mode"]
          default_clone_org: string | null
          github_app_installation_id: string | null
          github_owner: string
          github_repo: string
          id: string
          notes: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          default_branch?: string
          default_cascade_mode?: Database["public"]["Enums"]["cascade_mode"]
          default_clone_org?: string | null
          github_app_installation_id?: string | null
          github_owner: string
          github_repo: string
          id?: string
          notes?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          default_branch?: string
          default_cascade_mode?: Database["public"]["Enums"]["cascade_mode"]
          default_clone_org?: string | null
          github_app_installation_id?: string | null
          github_owner?: string
          github_repo?: string
          id?: string
          notes?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      push_delivery_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          notification_id: string | null
          status_code: number | null
          subscription_id: string | null
          success: boolean
          user_id: string | null
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          notification_id?: string | null
          status_code?: number | null
          subscription_id?: string | null
          success: boolean
          user_id?: string | null
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          notification_id?: string | null
          status_code?: number | null
          subscription_id?: string | null
          success?: boolean
          user_id?: string | null
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          last_used_at: string
          p256dh: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          last_used_at?: string
          p256dh: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          last_used_at?: string
          p256dh?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      route_errors: {
        Row: {
          created_at: string
          id: string
          message: string
          metadata: Json | null
          route_path: string
          stack: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          message: string
          metadata?: Json | null
          route_path: string
          stack?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          message?: string
          metadata?: Json | null
          route_path?: string
          stack?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      user_preferences: {
        Row: {
          created_at: string
          id: string
          name: string
          payload: Json
          scope: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          payload?: Json
          scope: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          payload?: Json
          scope?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_assign_role: {
        Args: {
          _assigner_id: string
          _target_role: Database["public"]["Enums"]["app_role"]
        }
        Returns: boolean
      }
      can_manage_user: {
        Args: { _manager_id: string; _target_user_id: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      highest_role_level: { Args: { _user_id: string }; Returns: number }
      is_operator: { Args: { _user_id: string }; Returns: boolean }
      role_level: {
        Args: { _role: Database["public"]["Enums"]["app_role"] }
        Returns: number
      }
    }
    Enums: {
      app_role: "super_admin" | "admin" | "operator" | "user"
      brand_assignment_status: "pending" | "applied" | "drifted" | "failed"
      brand_profile_status: "draft" | "published" | "archived"
      cascade_event_status:
        | "pending"
        | "running"
        | "completed"
        | "failed"
        | "partial"
      cascade_mode: "pr" | "auto_merge" | "notify"
      cascade_result_status:
        | "queued"
        | "pushing"
        | "succeeded"
        | "failed"
        | "pr_opened"
        | "skipped"
      cascade_schedule_kind: "fleet_cascade" | "module_sync" | "brand_sync"
      cascade_trigger: "manual" | "commit" | "scheduled"
      clone_backend_status:
        | "pending"
        | "provisioning"
        | "migrating"
        | "seeding_admin"
        | "ready"
        | "failed"
        | "suspended"
      drift_severity: "low" | "medium" | "high"
      module_status: "proposed" | "approved" | "archived" | "rejected"
      notification_kind:
        | "cascade_completed"
        | "cascade_failed"
        | "cascade_partial"
        | "cascade_started"
        | "drift_high"
        | "drift_medium"
        | "clone_created"
        | "clone_deleted"
        | "module_installed"
        | "module_removed"
        | "cascade_awaiting_approval"
        | "cascade_approved"
        | "cascade_rejected"
        | "library_entry_approved"
        | "library_entry_rejected"
      notification_severity: "info" | "success" | "warning" | "error"
      provisioning_method: "fork" | "template" | "clone"
      sync_status: "in_sync" | "behind" | "cascading" | "failed" | "unknown"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["super_admin", "admin", "operator", "user"],
      brand_assignment_status: ["pending", "applied", "drifted", "failed"],
      brand_profile_status: ["draft", "published", "archived"],
      cascade_event_status: [
        "pending",
        "running",
        "completed",
        "failed",
        "partial",
      ],
      cascade_mode: ["pr", "auto_merge", "notify"],
      cascade_result_status: [
        "queued",
        "pushing",
        "succeeded",
        "failed",
        "pr_opened",
        "skipped",
      ],
      cascade_schedule_kind: ["fleet_cascade", "module_sync", "brand_sync"],
      cascade_trigger: ["manual", "commit", "scheduled"],
      clone_backend_status: [
        "pending",
        "provisioning",
        "migrating",
        "seeding_admin",
        "ready",
        "failed",
        "suspended",
      ],
      drift_severity: ["low", "medium", "high"],
      module_status: ["proposed", "approved", "archived", "rejected"],
      notification_kind: [
        "cascade_completed",
        "cascade_failed",
        "cascade_partial",
        "cascade_started",
        "drift_high",
        "drift_medium",
        "clone_created",
        "clone_deleted",
        "module_installed",
        "module_removed",
        "cascade_awaiting_approval",
        "cascade_approved",
        "cascade_rejected",
        "library_entry_approved",
        "library_entry_rejected",
      ],
      notification_severity: ["info", "success", "warning", "error"],
      provisioning_method: ["fork", "template", "clone"],
      sync_status: ["in_sync", "behind", "cascading", "failed", "unknown"],
    },
  },
} as const
