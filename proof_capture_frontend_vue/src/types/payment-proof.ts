export type CaptureRequestStatus =
  | "pending"
  | "opened"
  | "uploaded"
  | "approved"
  | "rejected"
  | "expired"
  | "canceled";

export type ProofValidationStatus = "pending" | "approved" | "rejected";

export interface ApiResponse<T> {
  success: boolean;
  message: string;
  data: T;
  error_code?: string | null;
}

export interface CaptureRequestSummary {
  id: string;
  cash_session_id: string;
  payment_id: string;
  branch_id: string;
  requested_by_user_id: string;
  assigned_capture_user_id: string;
  status: CaptureRequestStatus;
  secure_token: string;
  token_expires_at: string;
  opened_at?: string | null;
  uploaded_at?: string | null;
  approved_at?: string | null;
  rejected_at?: string | null;
  canceled_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface PaymentSummary {
  payment_id: string;
  order_id: string;
  branch_id: string;
  amount: string;
  currency?: string | null;
  payment_method_name: string;
  status: string;
}

export interface PaymentProofSummary {
  id: string;
  payment_id: string;
  capture_request_id: string;
  bucket_name: string;
  object_path: string;
  file_name_stored: string;
  original_file_name?: string | null;
  mime_type: string;
  file_size: number;
  sha256_hash: string;
  image_width?: number | null;
  image_height?: number | null;
  uploaded_by_user_id: string;
  uploaded_at: string;
  validation_status: ProofValidationStatus;
  validated_by_user_id?: string | null;
  validated_at?: string | null;
  rejection_reason?: string | null;
  created_at: string;
  updated_at: string;
}

export interface MobileCaptureRequestView {
  capture_request: CaptureRequestSummary;
  payment: PaymentSummary;
  capture_user_name?: string | null;
  cash_session_status: string;
}

export interface PaymentProofWithRequest {
  proof?: PaymentProofSummary | null;
  capture_request?: CaptureRequestSummary | null;
}

export interface SignedProofUrlResponse {
  url: string;
  expires_in_seconds: number;
}

export interface PendingCaptureRequestItem {
  capture_request_id: string;
  secure_token: string;
  payment_id: string;
  amount: string;
  payment_method_name: string;
  status: CaptureRequestStatus;
  requested_at: string;
}

export interface CaptureUserOption {
  id: string;
  fullName: string;
  username: string;
  lastSeenAt?: string | null;
  isOnline?: boolean;
}
