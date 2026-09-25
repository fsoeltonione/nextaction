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
      integrations: {
        Row: {
          created_at: string
          id: string
          last_seen_at: string | null
          name: string
          product_id: string
          revoked_at: string | null
          status: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_seen_at?: string | null
          name: string
          product_id: string
          revoked_at?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          id?: string
          last_seen_at?: string | null
          name?: string
          product_id?: string
          revoked_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "integrations_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      moments: {
        Row: {
          created_at: string
          description: string | null
          id: string
          label: string
          moment_key: string
          product_id: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          label: string
          moment_key: string
          product_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          label?: string
          moment_key?: string
          product_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "moments_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      offer_moments: {
        Row: {
          created_at: string
          moment_id: string
          offer_id: string
        }
        Insert: {
          created_at?: string
          moment_id: string
          offer_id: string
        }
        Update: {
          created_at?: string
          moment_id?: string
          offer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "offer_moments_moment_id_fkey"
            columns: ["moment_id"]
            isOneToOne: false
            referencedRelation: "moments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offer_moments_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: false
            referencedRelation: "offers"
            referencedColumns: ["id"]
          },
        ]
      }
      offers: {
        Row: {
          budget_cents: number
          created_at: string
          cta_label: string
          cta_url: string
          description: string | null
          destination_url: string
          id: string
          spent_cents: number
          status: string
          target_moments: string[]
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          budget_cents?: number
          created_at?: string
          cta_label?: string
          cta_url: string
          description?: string | null
          destination_url: string
          id?: string
          spent_cents?: number
          status?: string
          target_moments?: string[]
          title: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          budget_cents?: number
          created_at?: string
          cta_label?: string
          cta_url?: string
          description?: string | null
          destination_url?: string
          id?: string
          spent_cents?: number
          status?: string
          target_moments?: string[]
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "offers_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          canonical_url: string
          created_at: string
          description: string | null
          domain: string
          id: string
          name: string
          understanding_status: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          canonical_url: string
          created_at?: string
          description?: string | null
          domain: string
          id?: string
          name: string
          understanding_status?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          canonical_url?: string
          created_at?: string
          description?: string | null
          domain?: string
          id?: string
          name?: string
          understanding_status?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_capabilities: {
        Row: {
          capability: string
          created_at: string
          status: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          capability: string
          created_at?: string
          status?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          capability?: string
          created_at?: string
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_capabilities_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_members: {
        Row: {
          created_at: string
          role: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          role: string
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          role?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          created_at: string
          created_by: string
          id: string
          name: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string
          id?: string
          name: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          name?: string
          user_id?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      check_runtime_rate_limit: {
        Args: {
          p_scope: string
          p_subject_hash: string
          p_limit: number
          p_window_seconds?: number
        }
        Returns: {
          allowed: boolean
          remaining: number
          retry_after_seconds: number
          request_count: number
        }[]
      }
      confirm_product_activation: {
        Args: {
          p_canonical_url: string
          p_description: string
          p_domain: string
          p_moments: Json
          p_name: string
        }
        Returns: {
          result_moment_count: number
          result_product_id: string
          result_workspace_id: string
        }[]
      }
      create_offer_activation: {
        Args: {
          p_cta_label: string
          p_description: string
          p_destination_url: string
          p_moment_ids: string[]
          p_title: string
        }
        Returns: {
          result_moment_count: number
          result_offer_id: string
          result_workspace_id: string
        }[]
      }
      resolve_runtime_integration: {
        Args: { p_credential_hash: string }
        Returns: {
          result_integration_id: string | null
          result_product_id: string | null
          result_status: string
          result_workspace_id: string | null
        }[]
      }
      runtime_accept_event: {
        Args: {
          p_integration_id: string
          p_idempotency_key: string
          p_event_type: string
          p_occurred_at: string | null
          p_payload: Json
          p_request_id: string
        }
        Returns: {
          result_created: boolean
          result_event_id: string
        }[]
      }
      runtime_create_decision_delivery: {
        Args: {
          p_delivery_nonce: string
          p_delivery_token_hash: string
          p_expires_at: string
          p_integration_id: string
          p_moment_key: string
          p_request_id: string
        }
        Returns: {
          result_cta_label: string | null
          result_decision_id: string
          result_delivery_id: string | null
          result_description: string | null
          result_destination_url: string | null
          result_expires_at: string | null
          result_offer_id: string | null
          result_outcome: string
          result_reason_code: string | null
          result_title: string | null
        }[]
      }
      runtime_process_event: {
        Args: { p_event_id: string }
        Returns: {
          result_moment_occurrence_id: string | null
          result_processed: boolean
          result_reason_code: string | null
        }[]
      }
      runtime_worker_tick: {
        Args: {
          p_quantity?: number
          p_visibility_seconds?: number
        }
        Returns: {
          result_failed: number
          result_processed: number
        }[]
      }
      set_workspace_capabilities: {
        Args: { p_capabilities: string[] }
        Returns: {
          result_capability: string
          result_workspace_id: string
        }[]
      }
    }
    Enums: {
      [_ in never]: never
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
