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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string
          after_data: Json | null
          before_data: Json | null
          created_at: string
          entity: string
          entity_id: string | null
          id: string
          user_id: string | null
        }
        Insert: {
          action: string
          after_data?: Json | null
          before_data?: Json | null
          created_at?: string
          entity: string
          entity_id?: string | null
          id?: string
          user_id?: string | null
        }
        Update: {
          action?: string
          after_data?: Json | null
          before_data?: Json | null
          created_at?: string
          entity?: string
          entity_id?: string | null
          id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      branch_cancel_policy: {
        Row: {
          allow_direct_cancel: boolean
          branch_id: string
          created_at: string
          id: string
          is_kitchen_plate: boolean
          menu_node_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          allow_direct_cancel?: boolean
          branch_id: string
          created_at?: string
          id?: string
          is_kitchen_plate?: boolean
          menu_node_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          allow_direct_cancel?: boolean
          branch_id?: string
          created_at?: string
          id?: string
          is_kitchen_plate?: boolean
          menu_node_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "branch_cancel_policy_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "branch_cancel_policy_menu_node_id_fkey"
            columns: ["menu_node_id"]
            isOneToOne: false
            referencedRelation: "menu_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "branch_cancel_policy_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      branches: {
        Row: {
          address: string | null
          branch_code: string
          created_at: string
          display_code: string | null
          id: string
          is_active: boolean
          name: string
          printer_ip: string | null
          printer_port: number | null
          reference_table_count: number
          updated_at: string
          workflow_mode: string
        }
        Insert: {
          address?: string | null
          branch_code?: string
          created_at?: string
          display_code?: string | null
          id?: string
          is_active?: boolean
          name: string
          printer_ip?: string | null
          printer_port?: number | null
          reference_table_count?: number
          updated_at?: string
          workflow_mode?: string
        }
        Update: {
          address?: string | null
          branch_code?: string
          created_at?: string
          display_code?: string | null
          id?: string
          is_active?: boolean
          name?: string
          printer_ip?: string | null
          printer_port?: number | null
          reference_table_count?: number
          updated_at?: string
          workflow_mode?: string
        }
        Relationships: []
      }
      bancos: {
        Row: {
          activo: boolean
          created_at: string
          id: string
          nombre: string
          orden_visual: number
        }
        Insert: {
          activo?: boolean
          created_at?: string
          id?: string
          nombre: string
          orden_visual?: number
        }
        Update: {
          activo?: boolean
          created_at?: string
          id?: string
          nombre?: string
          orden_visual?: number
        }
        Relationships: []
      }
      comprobantes_pago: {
        Row: {
          id: string
          pago_id: string
          sucursal_id: string
          nombre_bucket: string
          ruta_objeto: string
          nombre_archivo: string
          tipo_mime: string
          tamano_bytes: number
          subido_por_usuario_id: string
          creado_en: string
        }
        Insert: {
          id?: string
          pago_id: string
          sucursal_id: string
          nombre_bucket?: string
          ruta_objeto: string
          nombre_archivo: string
          tipo_mime: string
          tamano_bytes: number
          subido_por_usuario_id: string
          creado_en?: string
        }
        Update: {
          id?: string
          pago_id?: string
          sucursal_id?: string
          nombre_bucket?: string
          ruta_objeto?: string
          nombre_archivo?: string
          tipo_mime?: string
          tamano_bytes?: number
          subido_por_usuario_id?: string
          creado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "comprobantes_pago_pago_id_fkey"
            columns: ["pago_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comprobantes_pago_sucursal_id_fkey"
            columns: ["sucursal_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comprobantes_pago_subido_por_usuario_id_fkey"
            columns: ["subido_por_usuario_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      bulk_included_product_ranges: {
        Row: {
          amount_from: number
          amount_to: number
          bulk_included_product_id: string
          created_at: string
          display_order: number
          id: string
          included_quantity: number
          updated_at: string
        }
        Insert: {
          amount_from: number
          amount_to: number
          bulk_included_product_id: string
          created_at?: string
          display_order?: number
          id?: string
          included_quantity: number
          updated_at?: string
        }
        Update: {
          amount_from?: number
          amount_to?: number
          bulk_included_product_id?: string
          created_at?: string
          display_order?: number
          id?: string
          included_quantity?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bulk_included_product_ranges_bulk_included_product_id_fkey"
            columns: ["bulk_included_product_id"]
            isOneToOne: false
            referencedRelation: "bulk_included_products"
            referencedColumns: ["id"]
          },
        ]
      }
      bulk_included_products: {
        Row: {
          created_at: string
          display_order: number
          id: string
          included_node_id: string
          is_active: boolean
          menu_node_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_order?: number
          id?: string
          included_node_id: string
          is_active?: boolean
          menu_node_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_order?: number
          id?: string
          included_node_id?: string
          is_active?: boolean
          menu_node_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bulk_included_products_included_node_id_fkey"
            columns: ["included_node_id"]
            isOneToOne: false
            referencedRelation: "menu_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bulk_included_products_menu_node_id_fkey"
            columns: ["menu_node_id"]
            isOneToOne: false
            referencedRelation: "menu_nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_movements: {
        Row: {
          created_at: string
          denomination_id: string | null
          id: string
          movement_code: string | null
          movement_number: number | null
          movement_type: Database["public"]["Enums"]["cash_movement_type"]
          payment_id: string | null
          qty_delta: number
          shift_id: string
        }
        Insert: {
          created_at?: string
          denomination_id?: string | null
          id?: string
          movement_code?: string | null
          movement_number?: number | null
          movement_type: Database["public"]["Enums"]["cash_movement_type"]
          payment_id?: string | null
          qty_delta?: number
          shift_id: string
        }
        Update: {
          created_at?: string
          denomination_id?: string | null
          id?: string
          movement_code?: string | null
          movement_number?: number | null
          movement_type?: Database["public"]["Enums"]["cash_movement_type"]
          payment_id?: string | null
          qty_delta?: number
          shift_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_movements_denomination_id_fkey"
            columns: ["denomination_id"]
            isOneToOne: false
            referencedRelation: "denominations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_movements_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_movements_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "cash_shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_register_movements: {
        Row: {
          amount: number
          branch_id: string
          created_at: string
          id: string
          movement_detail: Json | null
          movement_type: string
          reason: string
          recorded_by: string
          shift_id: string
        }
        Insert: {
          amount: number
          branch_id: string
          created_at?: string
          id?: string
          movement_detail?: Json | null
          movement_type: string
          reason: string
          recorded_by: string
          shift_id: string
        }
        Update: {
          amount?: number
          branch_id?: string
          created_at?: string
          id?: string
          movement_detail?: Json | null
          movement_type?: string
          reason?: string
          recorded_by?: string
          shift_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_register_movements_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_register_movements_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_register_movements_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "cash_shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_register_openings: {
        Row: {
          anulada_at: string | null
          anulada_por: string | null
          branch_id: string
          cashier_id: string
          closed_at: string | null
          created_at: string
          id: string
          initial_total: number
          motivo_anulacion: string | null
          notes: string | null
          opened_at: string
          shift_id: string
          status: string
          updated_at: string
        }
        Insert: {
          anulada_at?: string | null
          anulada_por?: string | null
          branch_id: string
          cashier_id: string
          closed_at?: string | null
          created_at?: string
          id?: string
          initial_total?: number
          motivo_anulacion?: string | null
          notes?: string | null
          opened_at?: string
          shift_id: string
          status: string
          updated_at?: string
        }
        Update: {
          anulada_at?: string | null
          anulada_por?: string | null
          branch_id?: string
          cashier_id?: string
          closed_at?: string | null
          created_at?: string
          id?: string
          initial_total?: number
          motivo_anulacion?: string | null
          notes?: string | null
          opened_at?: string
          shift_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_register_openings_anulada_por_fkey"
            columns: ["anulada_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_register_openings_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_register_openings_cashier_id_fkey"
            columns: ["cashier_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_register_openings_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "cash_shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_register_template_denoms: {
        Row: {
          created_at: string
          denomination_id: string
          id: string
          qty: number
          template_id: string
        }
        Insert: {
          created_at?: string
          denomination_id: string
          id?: string
          qty?: number
          template_id: string
        }
        Update: {
          created_at?: string
          denomination_id?: string
          id?: string
          qty?: number
          template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_register_template_denoms_denomination_id_fkey"
            columns: ["denomination_id"]
            isOneToOne: false
            referencedRelation: "denominations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_register_template_denoms_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "cash_register_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_register_templates: {
        Row: {
          branch_id: string
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          branch_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          branch_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_register_templates_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_register_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_shift_denoms: {
        Row: {
          denomination_id: string
          id: string
          qty_current: number
          qty_initial: number
          shift_id: string
        }
        Insert: {
          denomination_id: string
          id?: string
          qty_current?: number
          qty_initial?: number
          shift_id: string
        }
        Update: {
          denomination_id?: string
          id?: string
          qty_current?: number
          qty_initial?: number
          shift_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_shift_denoms_denomination_id_fkey"
            columns: ["denomination_id"]
            isOneToOne: false
            referencedRelation: "denominations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_shift_denoms_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "cash_shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_shift_users: {
        Row: {
          can_access_orders: boolean
          can_authorize_order_cancel: boolean
          can_dispatch_orders: boolean
          can_double_session: boolean
          can_edit_orders: boolean
          can_manage_products: boolean
          can_serve_tables: boolean
          can_use_caja: boolean
          created_at: string
          id: string
          is_enabled: boolean
          is_supervisor: boolean
          can_pack_orders: boolean
          caja_session_slots: string[]
          last_session_id: string | null
          secondary_session_id: string | null
          shift_id: string
          updated_at: string
          user_id: string
          secondary_caja_template_id: string | null
        }
        Insert: {
          can_access_orders?: boolean
          can_authorize_order_cancel?: boolean
          can_dispatch_orders?: boolean
          can_double_session?: boolean
          can_edit_orders?: boolean
          can_manage_products?: boolean
          can_serve_tables?: boolean
          can_use_caja?: boolean
          created_at?: string
          id?: string
          is_enabled?: boolean
          is_supervisor?: boolean
          can_pack_orders?: boolean
          caja_session_slots?: string[]
          last_session_id?: string | null
          secondary_session_id?: string | null
          shift_id: string
          updated_at?: string
          user_id: string
          secondary_caja_template_id?: string | null
        }
        Update: {
          can_access_orders?: boolean
          can_authorize_order_cancel?: boolean
          can_dispatch_orders?: boolean
          can_double_session?: boolean
          can_edit_orders?: boolean
          can_manage_products?: boolean
          can_serve_tables?: boolean
          can_use_caja?: boolean
          created_at?: string
          id?: string
          is_enabled?: boolean
          is_supervisor?: boolean
          can_pack_orders?: boolean
          caja_session_slots?: string[]
          last_session_id?: string | null
          secondary_session_id?: string | null
          shift_id?: string
          updated_at?: string
          user_id?: string
          secondary_caja_template_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cash_shift_users_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "cash_shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_shift_users_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_shifts: {
        Row: {
          active_tables_count: number
          max_caja_sessions: number
          branch_id: string
          caja_status: Database["public"]["Enums"]["caja_status"]
          capture_device_label: string | null
          capture_user_id: string | null
          cashier_id: string
          closed_at: string | null
          closed_by: string | null
          closed_from_device: string | null
          closed_from_user_agent: string | null
          id: string
          notes: string | null
          opened_at: string
          shift_code: string | null
          shift_number: number | null
          status: Database["public"]["Enums"]["cash_shift_status"]
        }
        Insert: {
          active_tables_count?: number
          max_caja_sessions?: number
          branch_id: string
          caja_status?: Database["public"]["Enums"]["caja_status"]
          capture_device_label?: string | null
          capture_user_id?: string | null
          cashier_id: string
          closed_at?: string | null
          closed_by?: string | null
          closed_from_device?: string | null
          closed_from_user_agent?: string | null
          id?: string
          notes?: string | null
          opened_at?: string
          shift_code?: string | null
          shift_number?: number | null
          status?: Database["public"]["Enums"]["cash_shift_status"]
        }
        Update: {
          active_tables_count?: number
          max_caja_sessions?: number
          branch_id?: string
          caja_status?: Database["public"]["Enums"]["caja_status"]
          capture_device_label?: string | null
          capture_user_id?: string | null
          cashier_id?: string
          closed_at?: string | null
          closed_by?: string | null
          closed_from_device?: string | null
          closed_from_user_agent?: string | null
          id?: string
          notes?: string | null
          opened_at?: string
          shift_code?: string | null
          shift_number?: number | null
          status?: Database["public"]["Enums"]["cash_shift_status"]
        }
        Relationships: [
          {
            foreignKeyName: "cash_shifts_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_shifts_capture_user_id_fkey"
            columns: ["capture_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_shifts_cashier_id_fkey"
            columns: ["cashier_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_shifts_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          branch_id: string
          created_at: string
          description: string
          display_order: number
          id: string
          is_active: boolean
          updated_at: string
        }
        Insert: {
          branch_id: string
          created_at?: string
          description: string
          display_order?: number
          id?: string
          is_active?: boolean
          updated_at?: string
        }
        Update: {
          branch_id?: string
          created_at?: string
          description?: string
          display_order?: number
          id?: string
          is_active?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "categories_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      denominations: {
        Row: {
          denomination_type: string
          display_order: number
          id: string
          image_url: string | null
          is_active: boolean
          label: string
          value: number
        }
        Insert: {
          denomination_type?: string
          display_order?: number
          id?: string
          image_url?: string | null
          is_active?: boolean
          label: string
          value: number
        }
        Update: {
          denomination_type?: string
          display_order?: number
          id?: string
          image_url?: string | null
          is_active?: boolean
          label?: string
          value?: number
        }
        Relationships: []
      }
      dispatch_assignments: {
        Row: {
          created_at: string | null
          dispatch_config_id: string | null
          dispatch_type: string
          id: string
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          dispatch_config_id?: string | null
          dispatch_type?: string
          id?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          dispatch_config_id?: string | null
          dispatch_type?: string
          id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dispatch_assignments_dispatch_config_id_fkey"
            columns: ["dispatch_config_id"]
            isOneToOne: false
            referencedRelation: "dispatch_config"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispatch_assignments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      dispatch_config: {
        Row: {
          branch_id: string | null
          created_at: string | null
          dispatch_mode: string
          id: string
          table_enabled: boolean
          takeout_enabled: boolean
          updated_at: string | null
        }
        Insert: {
          branch_id?: string | null
          created_at?: string | null
          dispatch_mode?: string
          id?: string
          table_enabled?: boolean
          takeout_enabled?: boolean
          updated_at?: string | null
        }
        Update: {
          branch_id?: string | null
          created_at?: string | null
          dispatch_mode?: string
          id?: string
          table_enabled?: boolean
          takeout_enabled?: boolean
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dispatch_config_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: true
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      entity_counters: {
        Row: {
          branch_id: string
          entity_key: string
          last_value: number
          period_key: string
          updated_at: string
        }
        Insert: {
          branch_id?: string
          entity_key: string
          last_value?: number
          period_key?: string
          updated_at?: string
        }
        Update: {
          branch_id?: string
          entity_key?: string
          last_value?: number
          period_key?: string
          updated_at?: string
        }
        Relationships: []
      }
      menu_node_modifiers: {
        Row: {
          created_at: string
          display_order: number
          id: string
          is_active: boolean
          modifier_id: string
          node_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_order?: number
          id?: string
          is_active?: boolean
          modifier_id: string
          node_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_order?: number
          id?: string
          is_active?: boolean
          modifier_id?: string
          node_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_node_modifiers_modifier_id_fkey"
            columns: ["modifier_id"]
            isOneToOne: false
            referencedRelation: "modifiers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_node_modifiers_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "menu_nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_nodes: {
        Row: {
          branch_id: string
          created_at: string
          depth: number
          description: string | null
          display_order: number
          icon: string | null
          id: string
          image_url: string | null
          is_active: boolean
          is_tray_category: boolean
          legacy_product_id: string | null
          manual_price_enabled: boolean
          menu_scope: string
          name: string
          node_type: string
          parent_id: string | null
          price: number | null
          updated_at: string
        }
        Insert: {
          branch_id: string
          created_at?: string
          depth?: number
          description?: string | null
          display_order?: number
          icon?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          is_tray_category?: boolean
          legacy_product_id?: string | null
          manual_price_enabled?: boolean
          menu_scope?: string
          name: string
          node_type: string
          parent_id?: string | null
          price?: number | null
          updated_at?: string
        }
        Update: {
          branch_id?: string
          created_at?: string
          depth?: number
          description?: string | null
          display_order?: number
          icon?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          is_tray_category?: boolean
          legacy_product_id?: string | null
          manual_price_enabled?: boolean
          menu_scope?: string
          name?: string
          node_type?: string
          parent_id?: string | null
          price?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_nodes_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_nodes_legacy_product_id_fkey"
            columns: ["legacy_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_nodes_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "menu_nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      modifiers: {
        Row: {
          branch_id: string
          created_at: string
          description: string
          id: string
          is_active: boolean
        }
        Insert: {
          branch_id: string
          created_at?: string
          description: string
          id?: string
          is_active?: boolean
        }
        Update: {
          branch_id?: string
          created_at?: string
          description?: string
          id?: string
          is_active?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "modifiers_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      modules: {
        Row: {
          code: string
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      operational_losses: {
        Row: {
          amount: number
          cancelled_by: string | null
          created_at: string | null
          id: string
          order_id: string | null
          order_item_id: string | null
          reason: string
        }
        Insert: {
          amount: number
          cancelled_by?: string | null
          created_at?: string | null
          id?: string
          order_id?: string | null
          order_item_id?: string | null
          reason: string
        }
        Update: {
          amount?: number
          cancelled_by?: string | null
          created_at?: string | null
          id?: string
          order_id?: string | null
          order_item_id?: string | null
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "operational_losses_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operational_losses_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operational_losses_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
        ]
      }
      order_cancellations: {
        Row: {
          cancellation_type: string
          created_at: string
          created_by: string
          id: string
          notes: string | null
          order_id: string
          reason: string
          status: string
        }
        Insert: {
          cancellation_type: string
          created_at?: string
          created_by: string
          id?: string
          notes?: string | null
          order_id: string
          reason: string
          status?: string
        }
        Update: {
          cancellation_type?: string
          created_at?: string
          created_by?: string
          id?: string
          notes?: string | null
          order_id?: string
          reason?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_cancellations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_cancellations_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_dispatch_events: {
        Row: {
          branch_id: string | null
          created_at: string
          created_by: string
          event_type: string
          id: string
          notes: string | null
          order_id: string
          source_module: string
          status: string
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          created_by: string
          event_type: string
          id?: string
          notes?: string | null
          order_id: string
          source_module: string
          status?: string
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          created_by?: string
          event_type?: string
          id?: string
          notes?: string | null
          order_id?: string
          source_module?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_dispatch_events_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_dispatch_events_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_dispatch_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_item_cancellations: {
        Row: {
          created_at: string
          id: string
          order_cancellation_id: string
          order_id: string
          order_item_id: string
          quantity_cancelled: number
          source_stage: string
          total_amount: number
          unit_price: number
        }
        Insert: {
          created_at?: string
          id?: string
          order_cancellation_id: string
          order_id: string
          order_item_id: string
          quantity_cancelled: number
          source_stage?: string
          total_amount: number
          unit_price: number
        }
        Update: {
          created_at?: string
          id?: string
          order_cancellation_id?: string
          order_id?: string
          order_item_id?: string
          quantity_cancelled?: number
          source_stage?: string
          total_amount?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_item_cancellations_order_cancellation_id_fkey"
            columns: ["order_cancellation_id"]
            isOneToOne: false
            referencedRelation: "order_cancellations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_item_cancellations_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_item_cancellations_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
        ]
      }
      order_item_dispatch_events: {
        Row: {
          created_at: string
          id: string
          order_dispatch_event_id: string
          order_id: string
          order_item_id: string
          quantity_dispatched: number
          source_stage: string
        }
        Insert: {
          created_at?: string
          id?: string
          order_dispatch_event_id: string
          order_id: string
          order_item_id: string
          quantity_dispatched: number
          source_stage: string
        }
        Update: {
          created_at?: string
          id?: string
          order_dispatch_event_id?: string
          order_id?: string
          order_item_id?: string
          quantity_dispatched?: number
          source_stage?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_item_dispatch_events_order_dispatch_event_id_fkey"
            columns: ["order_dispatch_event_id"]
            isOneToOne: false
            referencedRelation: "order_dispatch_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_item_dispatch_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_item_dispatch_events_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
        ]
      }
      order_item_modifiers: {
        Row: {
          id: string
          modifier_id: string
          order_item_id: string
        }
        Insert: {
          id?: string
          modifier_id: string
          order_item_id: string
        }
        Update: {
          id?: string
          modifier_id?: string
          order_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_item_modifiers_modifier_id_fkey"
            columns: ["modifier_id"]
            isOneToOne: false
            referencedRelation: "modifiers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_item_modifiers_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
        ]
      }
      order_item_ready_events: {
        Row: {
          created_at: string
          id: string
          order_id: string
          order_item_id: string
          order_ready_event_id: string
          quantity_ready: number
        }
        Insert: {
          created_at?: string
          id?: string
          order_id: string
          order_item_id: string
          order_ready_event_id: string
          quantity_ready: number
        }
        Update: {
          created_at?: string
          id?: string
          order_id?: string
          order_item_id?: string
          order_ready_event_id?: string
          quantity_ready?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_item_ready_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_item_ready_events_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_item_ready_events_order_ready_event_id_fkey"
            columns: ["order_ready_event_id"]
            isOneToOne: false
            referencedRelation: "order_ready_events"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          cancelled_from_status:
            | Database["public"]["Enums"]["order_item_status"]
            | null
          created_at: string
          description_snapshot: string
          dispatched_at: string | null
          id: string
          item_note: string | null
          order_id: string
          paid_at: string | null
          product_id: string
          quantity: number
          ready_at: string | null
          sent_to_kitchen_at: string | null
          status: Database["public"]["Enums"]["order_item_status"]
          total: number
          tray_container_cost: number
          tray_item_type: string | null
          unit_price: number
          /** Denormalizado desde orders.branch_id (Realtime por sucursal). */
          sucursal_id: string | null
        }
        Insert: {
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          cancelled_from_status?:
            | Database["public"]["Enums"]["order_item_status"]
            | null
          created_at?: string
          description_snapshot: string
          dispatched_at?: string | null
          id?: string
          item_note?: string | null
          order_id: string
          paid_at?: string | null
          product_id: string
          quantity?: number
          ready_at?: string | null
          sent_to_kitchen_at?: string | null
          status?: Database["public"]["Enums"]["order_item_status"]
          total: number
          tray_container_cost?: number
          tray_item_type?: string | null
          unit_price: number
          sucursal_id?: string | null
        }
        Update: {
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          cancelled_from_status?:
            | Database["public"]["Enums"]["order_item_status"]
            | null
          created_at?: string
          description_snapshot?: string
          dispatched_at?: string | null
          id?: string
          item_note?: string | null
          order_id?: string
          paid_at?: string | null
          product_id?: string
          quantity?: number
          ready_at?: string | null
          sent_to_kitchen_at?: string | null
          status?: Database["public"]["Enums"]["order_item_status"]
          total?: number
          tray_container_cost?: number
          tray_item_type?: string | null
          unit_price?: number
          sucursal_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_items_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_sucursal_id_fkey"
            columns: ["sucursal_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      order_ready_events: {
        Row: {
          branch_id: string | null
          created_at: string
          created_by: string
          event_type: string
          id: string
          notes: string | null
          order_id: string
          source_module: string
          status: string
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          created_by: string
          event_type: string
          id?: string
          notes?: string | null
          order_id: string
          source_module: string
          status?: string
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          created_by?: string
          event_type?: string
          id?: string
          notes?: string | null
          order_id?: string
          source_module?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_ready_events_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_ready_events_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_ready_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          branch_id: string
          cash_shift_id: string | null
          cancel_requested_at: string | null
          cancel_requested_by: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          cancelled_from_status: string | null
          closed_at: string | null
          created_at: string
          created_by: string
          dispatched_at: string | null
          id: string
          is_special: boolean
          is_tray_order: boolean
          locked_for_editing: boolean | null
          menu_scope: string
          order_code: string | null
          order_number: number | null
          order_type: Database["public"]["Enums"]["order_type"]
          paid_at: string | null
          ready_at: string | null
          sent_to_kitchen_at: string | null
          special_marked_at: string | null
          special_marked_by: string | null
          special_origin_split_id: string | null
          special_origin_table_id: string | null
          special_total_manual: number | null
          special_reason: string | null
          split_id: string | null
          status: Database["public"]["Enums"]["order_status"]
          table_id: string | null
          table_name_snapshot: string | null
          table_order_position: number | null
          total: number | null
          updated_at: string
        }
        Insert: {
          branch_id: string
          cash_shift_id?: string | null
          cancel_requested_at?: string | null
          cancel_requested_by?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          cancelled_from_status?: string | null
          closed_at?: string | null
          created_at?: string
          created_by: string
          dispatched_at?: string | null
          id?: string
          is_special?: boolean
          is_tray_order?: boolean
          locked_for_editing?: boolean | null
          menu_scope?: string
          order_code?: string | null
          order_number?: number | null
          order_type: Database["public"]["Enums"]["order_type"]
          paid_at?: string | null
          ready_at?: string | null
          sent_to_kitchen_at?: string | null
          special_marked_at?: string | null
          special_marked_by?: string | null
          special_origin_split_id?: string | null
          special_origin_table_id?: string | null
          special_total_manual?: number | null
          special_reason?: string | null
          split_id?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          table_id?: string | null
          table_name_snapshot?: string | null
          table_order_position?: number | null
          total?: number | null
          updated_at?: string
        }
        Update: {
          branch_id?: string
          cash_shift_id?: string | null
          cancel_requested_at?: string | null
          cancel_requested_by?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          cancelled_from_status?: string | null
          closed_at?: string | null
          created_at?: string
          created_by?: string
          dispatched_at?: string | null
          id?: string
          is_special?: boolean
          is_tray_order?: boolean
          locked_for_editing?: boolean | null
          menu_scope?: string
          order_code?: string | null
          order_number?: number | null
          order_type?: Database["public"]["Enums"]["order_type"]
          paid_at?: string | null
          ready_at?: string | null
          sent_to_kitchen_at?: string | null
          special_marked_at?: string | null
          special_marked_by?: string | null
          special_origin_split_id?: string | null
          special_origin_table_id?: string | null
          special_total_manual?: number | null
          special_reason?: string | null
          split_id?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          table_id?: string | null
          table_name_snapshot?: string | null
          table_order_position?: number | null
          total?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_cancel_requested_by_fkey"
            columns: ["cancel_requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_special_marked_by_fkey"
            columns: ["special_marked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_special_origin_split_id_fkey"
            columns: ["special_origin_split_id"]
            isOneToOne: false
            referencedRelation: "table_splits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_special_origin_table_id_fkey"
            columns: ["special_origin_table_id"]
            isOneToOne: false
            referencedRelation: "restaurant_tables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_split_id_fkey"
            columns: ["split_id"]
            isOneToOne: false
            referencedRelation: "table_splits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "restaurant_tables"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_capture_requests: {
        Row: {
          approved_at: string | null
          assigned_capture_user_id: string
          branch_id: string
          canceled_at: string | null
          cash_session_id: string
          created_at: string
          id: string
          opened_at: string | null
          payment_id: string
          rejected_at: string | null
          requested_by_user_id: string
          secure_token: string
          status: Database["public"]["Enums"]["payment_capture_request_status"]
          token_expires_at: string
          updated_at: string
          uploaded_at: string | null
        }
        Insert: {
          approved_at?: string | null
          assigned_capture_user_id: string
          branch_id: string
          canceled_at?: string | null
          cash_session_id: string
          created_at?: string
          id?: string
          opened_at?: string | null
          payment_id: string
          rejected_at?: string | null
          requested_by_user_id: string
          secure_token: string
          status?: Database["public"]["Enums"]["payment_capture_request_status"]
          token_expires_at: string
          updated_at?: string
          uploaded_at?: string | null
        }
        Update: {
          approved_at?: string | null
          assigned_capture_user_id?: string
          branch_id?: string
          canceled_at?: string | null
          cash_session_id?: string
          created_at?: string
          id?: string
          opened_at?: string | null
          payment_id?: string
          rejected_at?: string | null
          requested_by_user_id?: string
          secure_token?: string
          status?: Database["public"]["Enums"]["payment_capture_request_status"]
          token_expires_at?: string
          updated_at?: string
          uploaded_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_capture_requests_assigned_capture_user_id_fkey"
            columns: ["assigned_capture_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_capture_requests_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_capture_requests_cash_session_id_fkey"
            columns: ["cash_session_id"]
            isOneToOne: false
            referencedRelation: "cash_shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_capture_requests_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_capture_requests_requested_by_user_id_fkey"
            columns: ["requested_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_items: {
        Row: {
          created_at: string
          id: string
          order_item_id: string
          payment_id: string
          quantity_paid: number
          total_amount: number
          unit_price: number
        }
        Insert: {
          created_at?: string
          id?: string
          order_item_id: string
          payment_id: string
          quantity_paid: number
          total_amount: number
          unit_price: number
        }
        Update: {
          created_at?: string
          id?: string
          order_item_id?: string
          payment_id?: string
          quantity_paid?: number
          total_amount?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "payment_items_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_items_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_methods: {
        Row: {
          branch_id: string
          created_at: string
          id: string
          is_active: boolean
          name: string
        }
        Insert: {
          branch_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
        }
        Update: {
          branch_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_methods_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_proofs: {
        Row: {
          amount_matches_expected: boolean | null
          analysis_error_code: string | null
          analysis_ran_at: string | null
          analysis_status: string
          analysis_summary: string | null
          bucket_name: string
          capture_request_id: string
          created_at: string
          detected_amount: number | null
          file_name_stored: string
          file_size: number
          id: string
          image_height: number | null
          image_width: number | null
          mime_type: string
          object_path: string
          ocr_text: string | null
          original_file_name: string | null
          payment_id: string
          rejection_reason: string | null
          sha256_hash: string
          updated_at: string
          uploaded_at: string
          uploaded_by_user_id: string
          validated_at: string | null
          validated_by_user_id: string | null
          validation_status: Database["public"]["Enums"]["payment_proof_validation_status"]
        }
        Insert: {
          amount_matches_expected?: boolean | null
          analysis_error_code?: string | null
          analysis_ran_at?: string | null
          analysis_status: string
          analysis_summary?: string | null
          bucket_name: string
          capture_request_id: string
          created_at?: string
          detected_amount?: number | null
          file_name_stored: string
          file_size: number
          id?: string
          image_height?: number | null
          image_width?: number | null
          mime_type: string
          object_path: string
          ocr_text?: string | null
          original_file_name?: string | null
          payment_id: string
          rejection_reason?: string | null
          sha256_hash: string
          updated_at?: string
          uploaded_at?: string
          uploaded_by_user_id: string
          validated_at?: string | null
          validated_by_user_id?: string | null
          validation_status?: Database["public"]["Enums"]["payment_proof_validation_status"]
        }
        Update: {
          amount_matches_expected?: boolean | null
          analysis_error_code?: string | null
          analysis_ran_at?: string | null
          analysis_status?: string
          analysis_summary?: string | null
          bucket_name?: string
          capture_request_id?: string
          created_at?: string
          detected_amount?: number | null
          file_name_stored?: string
          file_size?: number
          id?: string
          image_height?: number | null
          image_width?: number | null
          mime_type?: string
          object_path?: string
          ocr_text?: string | null
          original_file_name?: string | null
          payment_id?: string
          rejection_reason?: string | null
          sha256_hash?: string
          updated_at?: string
          uploaded_at?: string
          uploaded_by_user_id?: string
          validated_at?: string | null
          validated_by_user_id?: string | null
          validation_status?: Database["public"]["Enums"]["payment_proof_validation_status"]
        }
        Relationships: [
          {
            foreignKeyName: "payment_proofs_capture_request_id_fkey"
            columns: ["capture_request_id"]
            isOneToOne: false
            referencedRelation: "payment_capture_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_proofs_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_proofs_uploaded_by_user_id_fkey"
            columns: ["uploaded_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_proofs_validated_by_user_id_fkey"
            columns: ["validated_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_void_requests: {
        Row: {
          approved_at: string | null
          approved_by_supervisor_id: string | null
          cash_refund_detail: Json | null
          created_at: string
          executed_at: string | null
          id: string
          order_id: string
          payment_id: string
          payment_item_selections: Json | null
          reason: string
          refund_amount: number | null
          refund_method: string | null
          rejected_at: string | null
          rejection_reason: string | null
          replacement_payment_id: string | null
          requested_by_user_id: string
          shift_id: string
          status: Database["public"]["Enums"]["payment_void_request_status"]
          terminal_id: string | null
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by_supervisor_id?: string | null
          cash_refund_detail?: Json | null
          created_at?: string
          executed_at?: string | null
          id?: string
          order_id: string
          payment_id: string
          payment_item_selections?: Json | null
          reason: string
          refund_amount?: number | null
          refund_method?: string | null
          rejected_at?: string | null
          rejection_reason?: string | null
          replacement_payment_id?: string | null
          requested_by_user_id: string
          shift_id: string
          status?: Database["public"]["Enums"]["payment_void_request_status"]
          terminal_id?: string | null
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by_supervisor_id?: string | null
          cash_refund_detail?: Json | null
          created_at?: string
          executed_at?: string | null
          id?: string
          order_id?: string
          payment_id?: string
          payment_item_selections?: Json | null
          reason?: string
          refund_amount?: number | null
          refund_method?: string | null
          rejected_at?: string | null
          rejection_reason?: string | null
          replacement_payment_id?: string | null
          requested_by_user_id?: string
          shift_id?: string
          status?: Database["public"]["Enums"]["payment_void_request_status"]
          terminal_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_void_requests_approved_by_supervisor_id_fkey"
            columns: ["approved_by_supervisor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_void_requests_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_void_requests_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_void_requests_replacement_payment_id_fkey"
            columns: ["replacement_payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_void_requests_requested_by_user_id_fkey"
            columns: ["requested_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_void_requests_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "cash_shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          banco_id: string | null
          change_amount: number | null
          created_at: string
          created_by: string
          currency: string | null
          id: string
          notes: string | null
          numero_transferencia: string | null
          order_id: string
          payment_code: string | null
          payment_method_id: string
          payment_number: number | null
          shift_id: string | null
          status: string
          updated_at: string
          void_approved_by_supervisor_id: string | null
          void_reason: string | null
          void_reference: string | null
          void_request_id: string | null
          void_requested_by_user_id: string | null
          void_terminal_id: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          amount: number
          banco_id?: string | null
          change_amount?: number | null
          created_at?: string
          created_by: string
          currency?: string | null
          id?: string
          notes?: string | null
          numero_transferencia?: string | null
          order_id: string
          payment_code?: string | null
          payment_method_id: string
          payment_number?: number | null
          shift_id?: string | null
          status?: string
          updated_at?: string
          void_approved_by_supervisor_id?: string | null
          void_reason?: string | null
          void_reference?: string | null
          void_request_id?: string | null
          void_requested_by_user_id?: string | null
          void_terminal_id?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          amount?: number
          banco_id?: string | null
          change_amount?: number | null
          created_at?: string
          created_by?: string
          currency?: string | null
          id?: string
          notes?: string | null
          numero_transferencia?: string | null
          order_id?: string
          payment_code?: string | null
          payment_method_id?: string
          payment_number?: number | null
          shift_id?: string | null
          status?: string
          updated_at?: string
          void_approved_by_supervisor_id?: string | null
          void_reason?: string | null
          void_reference?: string | null
          void_request_id?: string | null
          void_requested_by_user_id?: string | null
          void_terminal_id?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_banco_id_fkey"
            columns: ["banco_id"]
            isOneToOne: false
            referencedRelation: "bancos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_payment_method_id_fkey"
            columns: ["payment_method_id"]
            isOneToOne: false
            referencedRelation: "payment_methods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "cash_shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_void_approved_by_supervisor_id_fkey"
            columns: ["void_approved_by_supervisor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_void_request_id_fkey"
            columns: ["void_request_id"]
            isOneToOne: false
            referencedRelation: "payment_void_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_void_requested_by_user_id_fkey"
            columns: ["void_requested_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_voided_by_fkey"
            columns: ["voided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          created_at: string
          description: string
          display_order: number
          id: string
          is_active: boolean
          price_mode: Database["public"]["Enums"]["price_mode"]
          subcategory_id: string
          unit_price: number | null
          updated_at: string
          force_servir_module: boolean
        }
        Insert: {
          created_at?: string
          description: string
          display_order: number
          id?: string
          is_active?: boolean
          price_mode?: Database["public"]["Enums"]["price_mode"]
          subcategory_id: string
          unit_price?: number | null
          updated_at?: string
          force_servir_module?: boolean
        }
        Update: {
          created_at?: string
          description?: string
          display_order?: number
          id?: string
          is_active?: boolean
          price_mode?: Database["public"]["Enums"]["price_mode"]
          subcategory_id?: string
          unit_price?: number | null
          updated_at?: string
          force_servir_module?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "products_subcategory_id_fkey"
            columns: ["subcategory_id"]
            isOneToOne: false
            referencedRelation: "subcategories"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          active_branch_id: string | null
          alias: string
          avatar_url: string | null
          branch_id: string | null
          created_at: string
          current_app_session_device: string | null
          current_app_session_id: string | null
          current_app_session_started_at: string | null
          email: string | null
            first_name: string
            full_name: string
            home_address: string | null
            id: string
            identity_number: string | null
            is_active: boolean
            is_payment_proof_capture_operator: boolean
            is_protected_superadmin: boolean
            last_name: string
            phone: string | null
            role: string | null
          updated_at: string
          user_code: string | null
          username: string
        }
        Insert: {
          active_branch_id?: string | null
          alias: string
          avatar_url?: string | null
          branch_id?: string | null
          created_at?: string
          current_app_session_device?: string | null
          current_app_session_id?: string | null
          current_app_session_started_at?: string | null
          email?: string | null
            first_name: string
            full_name: string
            home_address?: string | null
            id: string
            identity_number?: string | null
            is_active?: boolean
            is_payment_proof_capture_operator?: boolean
            is_protected_superadmin?: boolean
            last_name: string
            phone?: string | null
            role?: string | null
          updated_at?: string
          user_code?: string | null
          username: string
        }
        Update: {
          active_branch_id?: string | null
          alias?: string
          avatar_url?: string | null
          branch_id?: string | null
          created_at?: string
          current_app_session_device?: string | null
          current_app_session_id?: string | null
          current_app_session_started_at?: string | null
          email?: string | null
            first_name?: string
            full_name?: string
            home_address?: string | null
            id?: string
            identity_number?: string | null
            is_active?: boolean
            is_payment_proof_capture_operator?: boolean
            is_protected_superadmin?: boolean
            last_name?: string
            phone?: string | null
            role?: string | null
          updated_at?: string
          user_code?: string | null
          username?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_active_branch_id_fkey"
            columns: ["active_branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      restaurant_tables: {
        Row: {
          branch_id: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          table_code: string | null
          table_number: number | null
          updated_at: string
          visual_order: number
        }
        Insert: {
          branch_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          table_code?: string | null
          table_number?: number | null
          updated_at?: string
          visual_order?: number
        }
        Update: {
          branch_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          table_code?: string | null
          table_number?: number | null
          updated_at?: string
          visual_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "restaurant_tables_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      role_permissions: {
        Row: {
          access_level: Database["public"]["Enums"]["access_level"]
          created_at: string
          module_id: string
          role_id: string
          updated_at: string
        }
        Insert: {
          access_level: Database["public"]["Enums"]["access_level"]
          created_at?: string
          module_id: string
          role_id: string
          updated_at?: string
        }
        Update: {
          access_level?: Database["public"]["Enums"]["access_level"]
          created_at?: string
          module_id?: string
          role_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "modules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_permissions_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      roles: {
        Row: {
          code: string
          created_at: string
          id: string
          is_active: boolean
          is_system: boolean
          name: string
          scope: Database["public"]["Enums"]["role_scope"]
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          is_system?: boolean
          name: string
          scope: Database["public"]["Enums"]["role_scope"]
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          is_system?: boolean
          name?: string
          scope?: Database["public"]["Enums"]["role_scope"]
          updated_at?: string
        }
        Relationships: []
      }
      subcategories: {
        Row: {
          category_id: string
          created_at: string
          description: string
          display_order: number
          id: string
          is_active: boolean
          updated_at: string
        }
        Insert: {
          category_id: string
          created_at?: string
          description: string
          display_order?: number
          id?: string
          is_active?: boolean
          updated_at?: string
        }
        Update: {
          category_id?: string
          created_at?: string
          description?: string
          display_order?: number
          id?: string
          is_active?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subcategories_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      subcategory_modifiers: {
        Row: {
          created_at: string
          display_order: number
          id: string
          is_active: boolean
          modifier_id: string
          subcategory_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_order?: number
          id?: string
          is_active?: boolean
          modifier_id: string
          subcategory_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_order?: number
          id?: string
          is_active?: boolean
          modifier_id?: string
          subcategory_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subcategory_modifiers_modifier_id_fkey"
            columns: ["modifier_id"]
            isOneToOne: false
            referencedRelation: "modifiers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subcategory_modifiers_subcategory_id_fkey"
            columns: ["subcategory_id"]
            isOneToOne: false
            referencedRelation: "subcategories"
            referencedColumns: ["id"]
          },
        ]
      }
      supervisor_branch_module_limits: {
        Row: {
          assigned_by: string | null
          branch_id: string
          created_at: string
          id: string
          is_allowed: boolean
          module_id: string
          supervisor_user_id: string
          updated_at: string
        }
        Insert: {
          assigned_by?: string | null
          branch_id: string
          created_at?: string
          id?: string
          is_allowed?: boolean
          module_id: string
          supervisor_user_id: string
          updated_at?: string
        }
        Update: {
          assigned_by?: string | null
          branch_id?: string
          created_at?: string
          id?: string
          is_allowed?: boolean
          module_id?: string
          supervisor_user_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "supervisor_branch_module_limits_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supervisor_branch_module_limits_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supervisor_branch_module_limits_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "modules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supervisor_branch_module_limits_supervisor_user_id_fkey"
            columns: ["supervisor_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      system_settings: {
        Row: {
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Update: {
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "system_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      table_splits: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          split_code: string
          table_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          split_code: string
          table_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          split_code?: string
          table_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "table_splits_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "restaurant_tables"
            referencedColumns: ["id"]
          },
        ]
      }
      user_branch_change_history: {
        Row: {
          branch_id: string | null
          change_type: string
          changed_at: string
          changed_by: string
          id: string
          new_branch_id: string | null
          new_value: Json | null
          previous_branch_id: string | null
          previous_value: Json | null
          reason: string | null
          user_id: string
        }
        Insert: {
          branch_id?: string | null
          change_type: string
          changed_at?: string
          changed_by: string
          id?: string
          new_branch_id?: string | null
          new_value?: Json | null
          previous_branch_id?: string | null
          previous_value?: Json | null
          reason?: string | null
          user_id: string
        }
        Update: {
          branch_id?: string | null
          change_type?: string
          changed_at?: string
          changed_by?: string
          id?: string
          new_branch_id?: string | null
          new_value?: Json | null
          previous_branch_id?: string | null
          previous_value?: Json | null
          reason?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_branch_change_history_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_branch_change_history_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_branch_change_history_new_branch_id_fkey"
            columns: ["new_branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_branch_change_history_previous_branch_id_fkey"
            columns: ["previous_branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_branch_change_history_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_branch_modules: {
        Row: {
          assigned_by: string | null
          branch_id: string
          created_at: string
          id: string
          is_active: boolean
          module_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          assigned_by?: string | null
          branch_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          module_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          assigned_by?: string | null
          branch_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          module_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_branch_modules_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_branch_modules_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_branch_modules_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "modules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_branch_modules_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_branch_roles: {
        Row: {
          assigned_by: string | null
          branch_id: string
          created_at: string
          id: string
          is_active: boolean
          role_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          assigned_by?: string | null
          branch_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          role_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          assigned_by?: string | null
          branch_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          role_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_branch_roles_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_branch_roles_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_branch_roles_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_branch_roles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_branches: {
        Row: {
          branch_id: string
          id: string
          user_id: string
        }
        Insert: {
          branch_id: string
          id?: string
          user_id: string
        }
        Update: {
          branch_id?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_branches_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_branches_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_global_roles: {
        Row: {
          assigned_by: string | null
          created_at: string
          id: string
          is_active: boolean
          role_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          assigned_by?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          role_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          assigned_by?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          role_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_global_roles_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_global_roles_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_global_roles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_module_change_history: {
        Row: {
          action_type: string
          branch_id: string
          changed_at: string
          changed_by: string
          id: string
          module_id: string
          new_value: Json | null
          previous_value: Json | null
          reason: string | null
          user_id: string
        }
        Insert: {
          action_type: string
          branch_id: string
          changed_at?: string
          changed_by: string
          id?: string
          module_id: string
          new_value?: Json | null
          previous_value?: Json | null
          reason?: string | null
          user_id: string
        }
        Update: {
          action_type?: string
          branch_id?: string
          changed_at?: string
          changed_by?: string
          id?: string
          module_id?: string
          new_value?: Json | null
          previous_value?: Json | null
          reason?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_module_change_history_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_module_change_history_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_module_change_history_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "modules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_module_change_history_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      webauthn_challenges: {
        Row: {
          challenge: string
          created_at: string
          id: string
          type: string
          user_id: string | null
        }
        Insert: {
          challenge: string
          created_at?: string
          id?: string
          type?: string
          user_id?: string | null
        }
        Update: {
          challenge?: string
          created_at?: string
          id?: string
          type?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "webauthn_challenges_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      webauthn_credentials: {
        Row: {
          counter: number
          created_at: string
          credential_id: string
          device_name: string | null
          id: string
          public_key: string
          transports: string[] | null
          user_id: string
        }
        Insert: {
          counter?: number
          created_at?: string
          credential_id: string
          device_name?: string | null
          id?: string
          public_key: string
          transports?: string[] | null
          user_id: string
        }
        Update: {
          counter?: number
          created_at?: string
          credential_id?: string
          device_name?: string | null
          id?: string
          public_key?: string
          transports?: string[] | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "webauthn_credentials_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      v_user_accessible_branches: {
        Row: {
          branch_id: string | null
          user_id: string | null
        }
        Relationships: []
      }
      v_user_effective_permissions: {
        Row: {
          access_level: Database["public"]["Enums"]["access_level"] | null
          branch_id: string | null
          module_code: string | null
          user_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      access_level_rank: {
        Args: { p_level: Database["public"]["Enums"]["access_level"] }
        Returns: number
      }
      add_dine_in_order_item: {
        Args: {
          p_description_snapshot?: string
          p_item_note?: string
          p_menu_node_id?: string
          p_modifier_ids?: string[]
          p_order_id: string
          p_product_id: string
          p_quantity?: number
          p_tray_container_cost?: number
          p_tray_item_type?: string
          p_unit_price?: number
        }
        Returns: string
      }
      add_tray_order_item:
        | {
            Args: {
              p_item_note?: string
              p_order_id: string
              p_product_id: string
              p_quantity: number
              p_tray_container_cost?: number
              p_tray_item_type: string
              p_unit_price: number
            }
            Returns: string
          }
        | {
            Args: {
              p_item_note?: string
              p_modifier_ids?: string[]
              p_order_id: string
              p_product_id: string
              p_quantity: number
              p_tray_container_cost?: number
              p_tray_item_type: string
              p_unit_price: number
            }
            Returns: string
          }
      admin_can_delete_user: { Args: { p_user_id: string }; Returns: Json }
      admin_list_access_catalog: { Args: never; Returns: Json }
      admin_list_users_access: { Args: never; Returns: Json }
      anular_apertura_caja: {
        Args: { p_motivo: string; p_turno_id: string }
        Returns: undefined
      }
      append_payment_note_marker: {
        Args: { p_existing_notes: string; p_marker: string }
        Returns: string
      }
      approve_and_void_payment: {
        Args: {
          p_cash_refund_detail?: Json
          p_current_shift_id: string
          p_payment_id: string
          p_payment_item_selections?: Json
          p_reason: string
          p_request_id: string
          p_requested_by_user_id: string
          p_supervisor_id: string
          p_terminal_id?: string
        }
        Returns: {
          order_id: string
          payment_id: string
          payment_status: string
          request_id: string
          shift_id: string
        }[]
      }
      assign_user_branch: {
        Args: {
          p_branch_id: string
          p_reason?: string
          p_target_user_id: string
        }
        Returns: boolean
      }
      assign_user_branch_role: {
        Args: {
          p_branch_id: string
          p_reason?: string
          p_role_code: string
          p_target_user_id: string
        }
        Returns: boolean
      }
      assign_user_global_role: {
        Args: { p_role_code: string; p_target_user_id: string }
        Returns: boolean
      }
      bootstrap_initial_superadmin: {
        Args: { p_reason?: string; p_target_user_id: string }
        Returns: boolean
      }
      can_manage_branch_admin: {
        Args: { p_branch_id: string; p_user_id: string }
        Returns: boolean
      }
      can_operate_cash_branch: {
        Args: { p_branch_id: string; p_user_id: string }
        Returns: boolean
      }
      can_void_payment: {
        Args: {
          p_current_shift_id: string
          p_payment_id: string
          p_user_id?: string
        }
        Returns: {
          can_void: boolean
          error_code: string
          error_message: string
          order_id: string
          payment_id: string
          payment_shift_id: string
          request_id: string
        }[]
      }
      cancel_empty_draft_orders_for_branch: {
        Args: { p_branch_id: string }
        Returns: number
      }
      cancel_order_quantities: {
        Args: {
          p_cancellation_type?: string
          p_cancelled_by: string
          p_items?: Json
          p_notes?: string
          p_order_id: string
          p_reason: string
        }
        Returns: string
      }
      claim_cash_session_slot: {
        Args: { p_session_id: string; p_shift_id: string }
        Returns: {
          last_session_id: string
          secondary_session_id: string
        }[]
      }
      get_caja_shift_terminal_usage: {
        Args: { p_branch_id: string }
        Returns: {
          shift_id: string
          shift_max: number
          global_sessions_used: number
        }[]
      }
      clear_my_single_session: {
        Args: { p_session_id?: string }
        Returns: undefined
      }
      clear_pending_order_cancellation_request: {
        Args: { p_order_id: string }
        Returns: number
      }
      close_cash_register: {
        Args: {
          p_branch_id: string
          p_cashier_id: string
          p_notes?: string
          p_shift_id: string
        }
        Returns: undefined
      }
      close_cash_shift_with_tables: {
        Args: {
          p_branch_id: string
          p_closed_from_device?: string
          p_closed_from_user_agent?: string
          p_notes?: string
          p_shift_id: string
        }
        Returns: undefined
      }
      force_close_cash_shift: {
        Args: {
          p_branch_id: string
          p_notes?: string
          p_shift_id: string
        }
        Returns: {
          drafts_deleted: number
          openings_closed: number
          ops_closed: number
          paid_closed: number
        }[]
      }
      close_dine_in_order_for_payment: {
        Args: { p_order_id: string }
        Returns: undefined
      }
      compact_table_order_positions: {
        Args: { p_table_id: string }
        Returns: undefined
      }
      configure_shift_active_tables: {
        Args: {
          p_active_tables_count: number
          p_branch_id: string
          p_shift_id: string
        }
        Returns: undefined
      }
      convert_order_to_special: {
        Args: { p_order_id: string; p_special_total_manual?: number }
        Returns: {
          is_special: boolean
          order_id: string
          source_split_id: string
          source_table_id: string
          special_total_manual: number
        }[]
      }
      copy_menu_scope_tree: {
        Args: {
          p_branch_id: string
          p_source_scope?: string
          p_target_scope?: string
        }
        Returns: number
      }
      create_additional_dine_in_order: {
        Args: { p_source_order_id: string }
        Returns: string
      }
      create_dine_in_order: {
        Args: {
          p_branch_id: string
          p_created_by: string
          p_is_special?: boolean
          p_table_id?: string
        }
        Returns: string
      }
      create_pending_order_cancellation_request: {
        Args: {
          p_cancellation_type?: string
          p_items?: Json
          p_notes?: string
          p_order_id: string
          p_reason: string
          p_user_id: string
        }
        Returns: string
      }
      create_tray_order: {
        Args: { p_branch_id: string; p_created_by: string }
        Returns: string
      }
      delete_dine_in_table_order: {
        Args: { p_order_id: string }
        Returns: string
      }
      purge_empty_dine_in_draft_order: {
        Args: { p_order_id: string }
        Returns: string
      }
      purge_empty_dine_in_draft_orders_for_branch: {
        Args: { p_branch_id: string }
        Returns: number
      }
      purge_empty_dine_in_draft_orders_for_table: {
        Args: { p_keep_order_id?: string | null; p_table_id: string }
        Returns: number
      }
      dispatch_order_quantities: {
        Args: {
          p_dispatched_by: string
          p_items?: Json
          p_notes?: string
          p_operation_type?: string
          p_order_id: string
          p_source_module?: string
        }
        Returns: string
      }
      emit_order_ready_alert: {
        Args: {
          p_emitted_by: string
          p_order_id: string
          p_source_module?: string
        }
        Returns: string
      }
      ensure_branch_table_capacity: {
        Args: { p_branch_id: string; p_requested_count: number }
        Returns: number
      }
      get_branch_cancel_policy_for_product: {
        Args: { p_branch_id: string; p_product_id: string }
        Returns: {
          allow_direct_cancel: boolean
          is_kitchen_plate: boolean
          policy_menu_node_id: string
          policy_menu_node_name: string
        }[]
      }
      get_branch_order_prefix: {
        Args: { p_branch_id: string }
        Returns: string
      }
      get_branch_tables_overview: {
        Args: { p_branch_id: string }
        Returns: {
          active_order_id: string
          active_order_status: string
          elapsed_minutes: number
          item_count: number
          split_count: number
          split_totals: Json
          status: string
          table_id: string
          table_is_active: boolean
          table_name: string
          total_due: number
          visual_order: number
        }[]
      }
      get_mesero_ready_alerts: {
        Args: { p_branch_id: string; p_created_by: string; p_limit?: number }
        Returns: {
          branch_id: string
          created_at: string
          created_by: string
          notification_id: string
          order_id: string
          order_number: number
          order_type: string
          split_code: string
          table_name: string
        }[]
      }
      get_my_access_context: { Args: never; Returns: Json }
      get_my_open_shift_branch_id: { Args: never; Returns: string | null }
      get_my_branch_shift_gate: {
        Args: { p_branch_id: string }
        Returns: {
          active_tables_count: number
          caja_status: Database["public"]["Enums"]["caja_status"]
          can_access_orders: boolean
          can_authorize_order_cancel: boolean
          can_dispatch_orders: boolean
          can_manage_products: boolean
          can_serve_tables: boolean
          can_use_caja: boolean
          is_supervisor: boolean
          shift_id: string | null
          shift_open: boolean
          user_enabled: boolean
        }[]
      }
      get_my_branch_shift_gate_v2: {
        Args: { p_branch_id: string }
        Returns: {
          active_tables_count: number
          caja_session_slots: string[]
          caja_status: Database["public"]["Enums"]["caja_status"]
          can_access_orders: boolean
          can_authorize_order_cancel: boolean
          can_dispatch_orders: boolean
          can_double_session: boolean
          can_edit_orders: boolean
          can_manage_products: boolean
          can_pack_orders: boolean
          can_serve_plates: boolean
          can_serve_tables: boolean
          can_use_caja: boolean
          capture_user_id: string | null
          cashier_id: string | null
          global_caja_sessions_used: number
          is_secondary_cashier: boolean
          is_stale_shift: boolean
          is_supervisor: boolean
          last_session_id: string | null
          legacy_fallback_applied: boolean
          max_caja_sessions: number
          opened_at: string | null
          primary_cashier_id: string | null
          secondary_caja_express_enabled: boolean
          secondary_caja_takeout_enabled: boolean
          secondary_session_id: string | null
          shift_id: string | null
          shift_open: boolean
          user_enabled: boolean
        }[]
      }
      get_order_operational_snapshot: {
        Args: { p_order_id: string }
        Returns: {
          description_snapshot: string
          item_status: string
          order_id: string
          order_item_id: string
          quantity_cancelled_dispatched: number
          quantity_cancelled_pending: number
          quantity_cancelled_ready: number
          quantity_cancelled_total: number
          quantity_dispatched_available: number
          quantity_dispatched_total: number
          quantity_ordered: number
          quantity_paid: number
          quantity_pending_prepare: number
          quantity_ready_available: number
          quantity_ready_total: number
          unit_price: number
        }[]
      }
      /** Solo cantidades; no reemplaza get_orders_operational_snapshots. */
      get_orders_operational_snapshots_lite: {
        Args: { p_order_ids: string[] }
        Returns: {
          order_id: string
          order_item_id: string
          quantity_cancelled_dispatched: number
          quantity_cancelled_pending: number
          quantity_cancelled_ready: number
          quantity_cancelled_total: number
          quantity_dispatched_available: number
          quantity_dispatched_total: number
          quantity_ordered: number
          quantity_paid: number
          quantity_pending_prepare: number
          quantity_ready_available: number
          quantity_ready_total: number
        }[]
      }
      get_table_products_by_root_orders: {
        Args: { p_branch_id: string; p_root_orders?: number[] }
        Returns: {
          display_order: number
          legacy_product_id: string
          name: string
          node_id: string
          root_display_order: number
          root_node_id: string
        }[]
      }
      get_tray_menu_nodes: {
        Args: { p_branch_id: string }
        Returns: {
          branch_id: string
          depth: number
          display_order: number
          id: string
          image_url: string
          is_active: boolean
          is_tray_category: boolean
          legacy_product_id: string
          menu_scope: string
          name: string
          node_type: string
          parent_id: string
          price: number
        }[]
      }
      get_user_shift_role_capabilities: {
        Args: { p_branch_id: string; p_user_id: string }
        Returns: {
          can_assign_dispatch_orders: boolean
          can_assign_serve_tables: boolean
          can_assign_use_caja: boolean
          can_be_supervisor: boolean
        }[]
      }
      has_any_role: { Args: { _user_id: string }; Returns: boolean }
      has_branch_permission: {
        Args: {
          p_branch_id: string
          p_module_code: string
          p_required: Database["public"]["Enums"]["access_level"]
          p_user_id: string
        }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      infer_payment_shift_id: {
        Args: {
          p_created_at?: string
          p_order_id: string
          p_require_open?: boolean
        }
        Returns: string
      }
      is_admin_or_superadmin: { Args: { _user_id: string }; Returns: boolean }
      is_global_admin: { Args: { _user_id: string }; Returns: boolean }
      is_payment_void_authorizer: {
        Args: { p_branch_id: string; p_shift_id: string; p_user_id: string }
        Returns: boolean
      }
      is_system_bypass: { Args: never; Returns: boolean }
      list_branch_cancel_policy_nodes: {
        Args: { p_branch_id: string }
        Returns: {
          allow_direct_cancel: boolean
          depth: number
          descendant_product_count: number
          is_kitchen_plate: boolean
          is_primary_root_category: boolean
          menu_node_id: string
          menu_node_name: string
          menu_scope: string
          parent_id: string
        }[]
      }
      list_branch_closure_blocking_orders: {
        Args: { p_branch_id: string }
        Returns: {
          created_at: string
          order_id: string
          order_status: Database["public"]["Enums"]["order_status"]
          paid_at: string
          reference_label: string
          updated_at: string
        }[]
      }
      get_branch_shift_closure_blockers: {
        Args: { p_branch_id: string }
        Returns: Json
      }
      format_shift_closure_blockers_message: {
        Args: { p_branch_id: string }
        Returns: string
      }
      list_cash_register_movements: {
        Args: { p_turno_id: string }
        Returns: {
          amount: number
          branch_id: string
          created_at: string
          id: string
          movement_detail: Json
          movement_type: string
          reason: string
          recorded_by: string
          recorded_by_name: string
          recorded_by_username: string
          shift_id: string
        }[]
      }
      list_cash_register_openings: {
        Args: { p_shift_id: string }
        Returns: {
          anulada_at: string
          anulada_por: string
          anulada_por_nombre: string
          anulada_por_username: string
          cashier_id: string
          cashier_name: string
          cashier_username: string
          closed_at: string
          id: string
          initial_total: number
          is_current: boolean
          motivo_anulacion: string
          notes: string
          opened_at: string
          payment_count: number
          shift_id: string
          status: string
        }[]
      }
      list_pending_order_cancellation_requests: {
        Args: { p_branch_id: string }
        Returns: {
          notes: string
          order_id: string
          requested_at: string
        }[]
      }
      list_shift_users_for_branch: {
        Args: { p_branch_id: string }
        Returns: {
          can_access_orders: boolean
          can_authorize_order_cancel: boolean
          can_dispatch_orders: boolean
          can_manage_products: boolean
          can_serve_tables: boolean
          can_use_caja: boolean
          full_name: string
          is_enabled: boolean
          is_profile_active: boolean
          is_supervisor: boolean
          user_id: string
          username: string
          alias: string
        }[]
      }
      mark_order_quantities_ready: {
        Args: {
          p_items?: Json
          p_notes?: string
          p_operation_type?: string
          p_order_id: string
          p_ready_by: string
          p_source_module?: string
        }
        Returns: string
      }
      max_access_level: {
        Args: {
          p_left: Database["public"]["Enums"]["access_level"]
          p_right: Database["public"]["Enums"]["access_level"]
        }
        Returns: Database["public"]["Enums"]["access_level"]
      }
      move_dine_in_order_items_between_orders: {
        Args: {
          p_destination_order_id: string
          p_items?: Json
          p_source_order_id: string
        }
        Returns: {
          destination_order_id: string
          moved_items: number
          moved_units: number
          source_order_id: string
        }[]
      }
      move_dine_in_order_to_table: {
        Args: { p_destination_table_id: string; p_order_id: string }
        Returns: {
          destination_was_occupied: boolean
          order_id: string
          split_code: string
          split_id: string
          table_id: string
        }[]
      }
      next_human_sequence: {
        Args: {
          p_branch_id?: string
          p_entity_key: string
          p_period_key?: string
        }
        Returns: number
      }
      next_table_order_position: {
        Args: { p_table_id: string }
        Returns: number
      }
      normalize_single_remaining_split_for_table: {
        Args: { p_table_id: string }
        Returns: undefined
      }
      open_cash_register: {
        Args: {
          p_branch_id: string
          p_cashier_id: string
          p_denoms?: Json
          p_shift_id: string
        }
        Returns: undefined
      }
      open_cash_shift_with_tables:
        | {
            Args: {
              p_active_tables_count: number
              p_branch_id: string
              p_cashier_id: string
              p_denoms?: Json
            }
            Returns: string
          }
        | {
            Args: {
              p_active_tables_count: number
              p_branch_id: string
              p_cashier_id: string
              p_denoms?: Json
              p_enabled_user_ids?: string[]
            }
            Returns: string
          }
        | {
            Args: {
              p_active_tables_count: number
              p_branch_id: string
              p_cashier_id: string
              p_enabled_users?: Database["public"]["CompositeTypes"]["shift_user_input"][]
            }
            Returns: string
          }
      order_has_dispatch_after: {
        Args: { p_after: string; p_order_id: string }
        Returns: boolean
      }
      recalculate_check_balance: {
        Args: { p_check_id: string }
        Returns: {
          order_id: string
          paid_at: string
          status: string
        }[]
      }
      recompute_order_operational_state: {
        Args: { p_order_id: string }
        Returns: undefined
      }
      register_my_single_session: {
        Args: { p_device_label?: string; p_session_id: string }
        Returns: undefined
      }
      registrar_movimiento_caja: {
        Args: {
          p_detail?: Json
          p_monto: number
          p_motivo: string
          p_tipo: string
          p_turno_id: string
        }
        Returns: {
          amount: number
          branch_id: string
          created_at: string
          id: string
          movement_detail: Json
          movement_type: string
          reason: string
          recorded_by: string
          recorded_by_name: string
          recorded_by_username: string
          shift_id: string
        }[]
      }
      registrar_movimiento_caja_operativo: {
        Args: {
          p_created_at?: string
          p_denomination_id?: string
          p_movement_type: Database["public"]["Enums"]["cash_movement_type"]
          p_payment_id?: string
          p_qty_delta: number
          p_shift_id: string
        }
        Returns: {
          created_at: string
          denomination_id: string | null
          id: string
          movement_code: string | null
          movement_number: number | null
          movement_type: Database["public"]["Enums"]["cash_movement_type"]
          payment_id: string | null
          qty_delta: number
          shift_id: string
        }
        SetofOptions: {
          from: "*"
          to: "cash_movements"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      remove_user_branch: {
        Args: {
          p_branch_id: string
          p_reason?: string
          p_target_user_id: string
        }
        Returns: boolean
      }
      remove_user_branch_role:
        | {
            Args: {
              p_branch_id: string
              p_reason?: string
              p_target_user_id: string
            }
            Returns: boolean
          }
        | {
            Args: {
              p_branch_id: string
              p_reason?: string
              p_role_code: string
              p_target_user_id: string
            }
            Returns: boolean
          }
      remove_user_global_role: {
        Args: { p_role_code: string; p_target_user_id: string }
        Returns: boolean
      }
      request_order_cancellation: {
        Args: { p_order_id: string; p_user_id: string }
        Returns: undefined
      }
      request_void_payment: {
        Args: {
          p_cash_refund_detail?: Json
          p_current_shift_id: string
          p_payment_id: string
          p_payment_item_selections?: Json
          p_reason: string
          p_refund_method?: string
          p_terminal_id?: string
        }
        Returns: string
      }
      resolve_payment_shift_id: {
        Args: { p_created_at: string; p_order_id: string }
        Returns: string
      }
      restore_voided_dine_in_order_to_table: {
        Args: { p_order_id: string }
        Returns: undefined
      }
      save_branch_cancel_policy: {
        Args: { p_branch_id: string; p_policies?: Json }
        Returns: undefined
      }
      set_my_active_branch: { Args: { p_branch_id: string }; Returns: boolean }
      set_shift_user_enabled:
        | {
            Args: {
              p_is_enabled: boolean
              p_shift_id: string
              p_user_id: string
            }
            Returns: undefined
          }
        | {
            Args: {
              p_can_access_orders?: boolean
              p_can_authorize_order_cancel?: boolean
              p_can_dispatch_orders?: boolean
              p_can_manage_products?: boolean
              p_can_serve_tables?: boolean
              p_can_use_caja?: boolean
              p_is_enabled: boolean
              p_is_supervisor?: boolean
              p_shift_id: string
              p_user_id: string
            }
            Returns: undefined
          }
        | {
            Args: {
              p_can_access_orders?: boolean
              p_can_authorize_order_cancel?: boolean
              p_can_dispatch_orders?: boolean
              p_can_serve_tables?: boolean
              p_can_use_caja?: boolean
              p_is_enabled: boolean
              p_is_supervisor?: boolean
              p_shift_id: string
              p_user_id: string
            }
            Returns: undefined
          }
        | {
            Args: {
              p_can_authorize_order_cancel?: boolean
              p_can_dispatch_orders?: boolean
              p_can_serve_tables?: boolean
              p_can_use_caja?: boolean
              p_is_enabled: boolean
              p_is_supervisor?: boolean
              p_shift_id: string
              p_user_id: string
            }
            Returns: undefined
          }
      set_supervisor_module_limit: {
        Args: {
          p_branch_id: string
          p_is_allowed: boolean
          p_module_code: string
          p_supervisor_user_id: string
        }
        Returns: boolean
      }
      set_user_active_branch: {
        Args: {
          p_new_branch_id: string
          p_reason?: string
          p_target_user_id: string
        }
        Returns: boolean
      }
      set_user_payment_proof_capture_operator: {
        Args: {
          p_branch_id: string
          p_enabled?: boolean
          p_target_user_id: string
        }
        Returns: boolean
      }
      submit_order_draft_items: {
        Args: { p_order_id: string }
        Returns: {
          order_id: string
          order_status: Database["public"]["Enums"]["order_status"]
          submitted_item_count: number
        }[]
      }
      sync_order_payment_state: {
        Args: { p_order_id: string }
        Returns: {
          order_id: string
          paid_at: string
          status: string
        }[]
      }
      sync_order_payment_state_internal: {
        Args: { p_order_id: string }
        Returns: {
          order_id: string
          paid_at: string
          status: string
        }[]
      }
      upsert_user_branch_module: {
        Args: {
          p_branch_id: string
          p_is_active: boolean
          p_module_code: string
          p_reason?: string
          p_target_user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      access_level: "NONE" | "VIEW" | "OPERATE" | "MANAGE"
      app_role:
        | "admin"
        | "mesero"
        | "cajero"
        | "cocina"
        | "despachador_mesas"
        | "despachador_takeout"
        | "superadmin"
        | "supervisor"
      caja_status: "UNOPENED" | "OPEN" | "CLOSED"
      cash_movement_type: "OPENING" | "PAYMENT_IN" | "CHANGE_OUT"
      cash_shift_status: "OPEN" | "CLOSED"
      order_item_status: "DRAFT" | "SENT" | "DISPATCHED" | "PAID" | "CANCELLED"
      order_status:
        | "DRAFT"
        | "SENT_TO_KITCHEN"
        | "READY"
        | "KITCHEN_DISPATCHED"
        | "PAID"
        | "CANCELLED"
      order_type: "DINE_IN" | "TAKEOUT"
      payment_capture_request_status:
        | "pending"
        | "opened"
        | "uploaded"
        | "approved"
        | "rejected"
        | "expired"
        | "canceled"
      payment_proof_validation_status: "pending" | "approved" | "rejected"
      payment_void_request_status:
        | "pending"
        | "approved"
        | "rejected"
        | "executed"
      price_mode: "FIXED" | "MANUAL"
      role_scope: "GLOBAL" | "BRANCH"
    }
    CompositeTypes: {
      shift_user_input: {
        user_id: string | null
        can_serve_tables: boolean | null
        can_dispatch_orders: boolean | null
        can_use_caja: boolean | null
        can_authorize_order_cancel: boolean | null
        is_supervisor: boolean | null
        can_access_orders: boolean | null
        can_manage_products: boolean | null
      }
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
      access_level: ["NONE", "VIEW", "OPERATE", "MANAGE"],
      app_role: [
        "admin",
        "mesero",
        "cajero",
        "cocina",
        "despachador_mesas",
        "despachador_takeout",
        "superadmin",
        "supervisor",
      ],
      caja_status: ["UNOPENED", "OPEN", "CLOSED"],
      cash_movement_type: ["OPENING", "PAYMENT_IN", "CHANGE_OUT"],
      cash_shift_status: ["OPEN", "CLOSED"],
      order_item_status: ["DRAFT", "SENT", "DISPATCHED", "PAID", "CANCELLED"],
      order_status: [
        "DRAFT",
        "SENT_TO_KITCHEN",
        "READY",
        "KITCHEN_DISPATCHED",
        "PAID",
        "CANCELLED",
      ],
      order_type: ["DINE_IN", "TAKEOUT"],
      payment_capture_request_status: [
        "pending",
        "opened",
        "uploaded",
        "approved",
        "rejected",
        "expired",
        "canceled",
      ],
      payment_proof_validation_status: ["pending", "approved", "rejected"],
      payment_void_request_status: [
        "pending",
        "approved",
        "rejected",
        "executed",
      ],
      price_mode: ["FIXED", "MANUAL"],
      role_scope: ["GLOBAL", "BRANCH"],
    },
  },
} as const
