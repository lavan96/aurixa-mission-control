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
      cascade_events: {
        Row: {
          completed_at: string | null
          created_at: string
          id: string
          initiated_by: string | null
          mode: Database["public"]["Enums"]["cascade_mode"]
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
          completed_at?: string | null
          created_at?: string
          id?: string
          initiated_by?: string | null
          mode: Database["public"]["Enums"]["cascade_mode"]
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
          completed_at?: string | null
          created_at?: string
          id?: string
          initiated_by?: string | null
          mode?: Database["public"]["Enums"]["cascade_mode"]
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
      modules: {
        Row: {
          ai_confidence: number | null
          created_at: string
          dependencies: string[]
          description: string | null
          detected_by_ai: boolean
          file_globs: string[]
          id: string
          name: string
          routes: string[]
          slug: string
          status: Database["public"]["Enums"]["module_status"]
          updated_at: string
        }
        Insert: {
          ai_confidence?: number | null
          created_at?: string
          dependencies?: string[]
          description?: string | null
          detected_by_ai?: boolean
          file_globs?: string[]
          id?: string
          name: string
          routes?: string[]
          slug: string
          status?: Database["public"]["Enums"]["module_status"]
          updated_at?: string
        }
        Update: {
          ai_confidence?: number | null
          created_at?: string
          dependencies?: string[]
          description?: string | null
          detected_by_ai?: boolean
          file_globs?: string[]
          id?: string
          name?: string
          routes?: string[]
          slug?: string
          status?: Database["public"]["Enums"]["module_status"]
          updated_at?: string
        }
        Relationships: []
      }
      notification_preferences: {
        Row: {
          created_at: string
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
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
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
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_operator: { Args: { _user_id: string }; Returns: boolean }
    }
    Enums: {
      app_role: "admin" | "operator"
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
      cascade_schedule_kind: "fleet_cascade" | "module_sync"
      cascade_trigger: "manual" | "commit" | "scheduled"
      drift_severity: "low" | "medium" | "high"
      module_status: "proposed" | "approved" | "archived"
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
      app_role: ["admin", "operator"],
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
      cascade_schedule_kind: ["fleet_cascade", "module_sync"],
      cascade_trigger: ["manual", "commit", "scheduled"],
      drift_severity: ["low", "medium", "high"],
      module_status: ["proposed", "approved", "archived"],
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
      ],
      notification_severity: ["info", "success", "warning", "error"],
      provisioning_method: ["fork", "template", "clone"],
      sync_status: ["in_sync", "behind", "cascading", "failed", "unknown"],
    },
  },
} as const
