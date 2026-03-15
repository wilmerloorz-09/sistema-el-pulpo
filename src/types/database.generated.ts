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
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
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
      branches: {
        Row: {
          address: string | null
          branch_code: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          reference_table_count: number
          updated_at: string
        }
        Insert: {
          address?: string | null
          branch_code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          reference_table_count?: number
          updated_at?: string
        }
        Update: {
          address?: string | null
          branch_code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          reference_table_count?: number
          updated_at?: string
        }
        Relationships: []
      }
      cash_movements: {
        Row: {
          created_at: string
          denomination_id: string | null
          id: string
          movement_type: Database["public"]["Enums"]["cash_movement_type"]
          payment_id: string | null
          qty_delta: number
          shift_id: string
        }
        Insert: {
          created_at?: string
          denomination_id?: string | null
          id?: string
          movement_type: Database["public"]["Enums"]["cash_movement_type"]
          payment_id?: string | null
          qty_delta?: number
          shift_id: string
        }
        Update: {
          created_at?: string
          denomination_id?: string | null
          id?: string
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
      cash_shifts: {
        Row: {
          active_tables_count: number
          branch_id: string
          cashier_id: string
          closed_at: string | null
          id: string
          notes: string | null
          opened_at: string
          status: Database["public"]["Enums"]["cash_shift_status"]
        }
        Insert: {
          active_tables_count?: number
          branch_id: string
          cashier_id: string
          closed_at?: string | null
          id?: string
          notes?: string | null
          opened_at?: string
          status?: Database["public"]["Enums"]["cash_shift_status"]
        }
        Update: {
          active_tables_count?: number
          branch_id?: string
          cashier_id?: string
          closed_at?: string | null
          id?: string
          notes?: string | null
          opened_at?: string
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
            foreignKeyName: "cash_shifts_cashier_id_fkey"
            columns: ["cashier_id"]
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
          branch_id: string
          display_order: number
          id: string
          is_active: boolean
          label: string
          value: number
        }
        Insert: {
          branch_id: string
          display_order?: number
          id?: string
          is_active?: boolean
          label: string
          value: number
        }
        Update: {
          branch_id?: string
          display_order?: number
          id?: string
          is_active?: boolean
          label?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "denominations_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
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
          updated_at: string | null
        }
        Insert: {
          branch_id?: string | null
          created_at?: string | null
          dispatch_mode?: string
          id?: string
          updated_at?: string | null
        }
        Update: {
          branch_id?: string | null
          created_at?: string | null
          dispatch_mode?: string
          id?: string
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
      order_item_cancellations: {
        Row: {
          created_at: string
          id: string
          order_cancellation_id: string
          order_id: string
          order_item_id: string
          quantity_cancelled: number
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
          order_id: string
          paid_at: string | null
          product_id: string
          quantity: number
          ready_at: string | null
          sent_to_kitchen_at: string | null
          status: Database["public"]["Enums"]["order_item_status"]
          total: number
          unit_price: number
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
          order_id: string
          paid_at?: string | null
          product_id: string
          quantity?: number
          ready_at?: string | null
          sent_to_kitchen_at?: string | null
          status?: Database["public"]["Enums"]["order_item_status"]
          total: number
          unit_price: number
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
          order_id?: string
          paid_at?: string | null
          product_id?: string
          quantity?: number
          ready_at?: string | null
          sent_to_kitchen_at?: string | null
          status?: Database["public"]["Enums"]["order_item_status"]
          total?: number
          unit_price?: number
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
        ]
      }
      orders: {
        Row: {
          branch_id: string
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          cancelled_from_status: string | null
          closed_at: string | null
          created_at: string
          created_by: string
          dispatched_at: string | null
          id: string
          order_code: string | null
          order_number: number
          order_type: Database["public"]["Enums"]["order_type"]
          paid_at: string | null
          ready_at: string | null
          sent_to_kitchen_at: string | null
          split_id: string | null
          status: Database["public"]["Enums"]["order_status"]
          table_id: string | null
          total: number | null
          updated_at: string
        }
        Insert: {
          branch_id: string
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          cancelled_from_status?: string | null
          closed_at?: string | null
          created_at?: string
          created_by: string
          dispatched_at?: string | null
          id?: string
          order_code?: string | null
          order_number?: number
          order_type: Database["public"]["Enums"]["order_type"]
          paid_at?: string | null
          ready_at?: string | null
          sent_to_kitchen_at?: string | null
          split_id?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          table_id?: string | null
          total?: number | null
          updated_at?: string
        }
        Update: {
          branch_id?: string
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          cancelled_from_status?: string | null
          closed_at?: string | null
          created_at?: string
          created_by?: string
          dispatched_at?: string | null
          id?: string
          order_code?: string | null
          order_number?: number
          order_type?: Database["public"]["Enums"]["order_type"]
          paid_at?: string | null
          ready_at?: string | null
          sent_to_kitchen_at?: string | null
          split_id?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          table_id?: string | null
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
      payments: {
        Row: {
          amount: number
          change_amount: number | null
          created_at: string
          created_by: string
          id: string
          notes: string | null
          order_id: string
          payment_method_id: string
          shift_id: string | null
          status: string
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          amount: number
          change_amount?: number | null
          created_at?: string
          created_by: string
          id?: string
          notes?: string | null
          order_id: string
          payment_method_id: string
          shift_id?: string | null
          status?: string
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          amount?: number
          change_amount?: number | null
          created_at?: string
          created_by?: string
          id?: string
          notes?: string | null
          order_id?: string
          payment_method_id?: string
          shift_id?: string | null
          status?: string
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
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
          id: string
          is_active: boolean
          price_mode: Database["public"]["Enums"]["price_mode"]
          subcategory_id: string
          unit_price: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          description: string
          id?: string
          is_active?: boolean
          price_mode?: Database["public"]["Enums"]["price_mode"]
          subcategory_id: string
          unit_price?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          is_active?: boolean
          price_mode?: Database["public"]["Enums"]["price_mode"]
          subcategory_id?: string
          unit_price?: number | null
          updated_at?: string
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
          branch_id: string | null
          created_at: string
          full_name: string
          id: string
          is_active: boolean
          role: string | null
          updated_at: string
          username: string
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          full_name: string
          id: string
          is_active?: boolean
          role?: string | null
          updated_at?: string
          username: string
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          full_name?: string
          id?: string
          is_active?: boolean
          role?: string | null
          updated_at?: string
          username?: string
        }
        Relationships: [
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
          updated_at: string
          visual_order: number
        }
        Insert: {
          branch_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
          visual_order?: number
        }
        Update: {
          branch_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
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
      [_ in never]: never
    }
    Functions: {
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
      has_any_role: { Args: { _user_id: string }; Returns: boolean }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role:
        | "admin"
        | "mesero"
        | "cajero"
        | "cocina"
        | "despachador_mesas"
        | "despachador_takeout" | "supervisor" | "superadmin"
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
      price_mode: "FIXED" | "MANUAL"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      app_role: [
        "admin",
        "mesero",
        "cajero",
        "cocina",
        "despachador_mesas",
        "despachador_takeout", "supervisor", "superadmin",
      ],
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
      price_mode: ["FIXED", "MANUAL"],
    },
  },
} as const

