DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'payment_capture_request_status'
      AND typnamespace = 'public'::regnamespace
  ) THEN
    CREATE TYPE public.payment_capture_request_status AS ENUM (
      'pending',
      'opened',
      'uploaded',
      'approved',
      'rejected',
      'expired',
      'canceled'
    );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'payment_proof_validation_status'
      AND typnamespace = 'public'::regnamespace
  ) THEN
    CREATE TYPE public.payment_proof_validation_status AS ENUM (
      'pending',
      'approved',
      'rejected'
    );
  END IF;
END
$$;

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS currency text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'completed',
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS public.payment_capture_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cash_session_id uuid NOT NULL REFERENCES public.cash_shifts(id) ON DELETE CASCADE,
  payment_id uuid NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  requested_by_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  assigned_capture_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  status public.payment_capture_request_status NOT NULL DEFAULT 'pending',
  secure_token text NOT NULL,
  token_expires_at timestamptz NOT NULL,
  opened_at timestamptz NULL,
  uploaded_at timestamptz NULL,
  approved_at timestamptz NULL,
  rejected_at timestamptz NULL,
  canceled_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ix_payment_capture_requests_secure_token
  ON public.payment_capture_requests (secure_token);

CREATE INDEX IF NOT EXISTS ix_payment_capture_requests_branch_status
  ON public.payment_capture_requests (branch_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_capture_requests_active_payment
  ON public.payment_capture_requests (payment_id)
  WHERE status IN ('pending', 'opened', 'uploaded');

CREATE TABLE IF NOT EXISTS public.payment_proofs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  capture_request_id uuid NOT NULL REFERENCES public.payment_capture_requests(id) ON DELETE CASCADE,
  bucket_name text NOT NULL,
  object_path text NOT NULL,
  file_name_stored text NOT NULL,
  original_file_name text NULL,
  mime_type text NOT NULL,
  file_size integer NOT NULL,
  sha256_hash text NOT NULL,
  image_width integer NULL,
  image_height integer NULL,
  uploaded_by_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  validation_status public.payment_proof_validation_status NOT NULL DEFAULT 'pending',
  validated_by_user_id uuid NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  validated_at timestamptz NULL,
  rejection_reason text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_proofs_object_path
  ON public.payment_proofs (object_path);

CREATE INDEX IF NOT EXISTS ix_payment_proofs_payment_id
  ON public.payment_proofs (payment_id);

CREATE INDEX IF NOT EXISTS ix_payment_proofs_capture_request_id
  ON public.payment_proofs (capture_request_id);

DROP TRIGGER IF EXISTS trg_payment_capture_requests_updated_at ON public.payment_capture_requests;
CREATE TRIGGER trg_payment_capture_requests_updated_at
BEFORE UPDATE ON public.payment_capture_requests
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_payment_proofs_updated_at ON public.payment_proofs;
CREATE TRIGGER trg_payment_proofs_updated_at
BEFORE UPDATE ON public.payment_proofs
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_payments_updated_at_payment_proofs ON public.payments;
CREATE TRIGGER trg_payments_updated_at_payment_proofs
BEFORE UPDATE ON public.payments
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.payment_capture_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_proofs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view payment capture requests" ON public.payment_capture_requests;
CREATE POLICY "Users can view payment capture requests"
ON public.payment_capture_requests
FOR SELECT
TO authenticated
USING (
  assigned_capture_user_id = auth.uid()
  OR requested_by_user_id = auth.uid()
  OR public.can_operate_cash_branch(auth.uid(), branch_id)
  OR public.can_manage_branch_admin(auth.uid(), branch_id)
);

DROP POLICY IF EXISTS "Users can insert payment capture requests" ON public.payment_capture_requests;
CREATE POLICY "Users can insert payment capture requests"
ON public.payment_capture_requests
FOR INSERT
TO authenticated
WITH CHECK (
  requested_by_user_id = auth.uid()
  AND (
    public.can_operate_cash_branch(auth.uid(), branch_id)
    OR public.can_manage_branch_admin(auth.uid(), branch_id)
  )
  AND EXISTS (
    SELECT 1
    FROM public.cash_shifts cs
    JOIN public.payments p ON p.id = payment_capture_requests.payment_id
    JOIN public.orders o ON o.id = p.order_id
    WHERE cs.id = payment_capture_requests.cash_session_id
      AND cs.branch_id = payment_capture_requests.branch_id
      AND cs.status = 'OPEN'
      AND cs.capture_user_id = payment_capture_requests.assigned_capture_user_id
      AND o.branch_id = payment_capture_requests.branch_id
      AND p.created_by = auth.uid()
  )
);

DROP POLICY IF EXISTS "Users can update payment capture requests" ON public.payment_capture_requests;
CREATE POLICY "Users can update payment capture requests"
ON public.payment_capture_requests
FOR UPDATE
TO authenticated
USING (
  assigned_capture_user_id = auth.uid()
  OR requested_by_user_id = auth.uid()
  OR public.can_operate_cash_branch(auth.uid(), branch_id)
  OR public.can_manage_branch_admin(auth.uid(), branch_id)
)
WITH CHECK (
  assigned_capture_user_id = auth.uid()
  OR requested_by_user_id = auth.uid()
  OR public.can_operate_cash_branch(auth.uid(), branch_id)
  OR public.can_manage_branch_admin(auth.uid(), branch_id)
);

DROP POLICY IF EXISTS "Users can view payment proofs" ON public.payment_proofs;
CREATE POLICY "Users can view payment proofs"
ON public.payment_proofs
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.payment_capture_requests pcr
    WHERE pcr.id = payment_proofs.capture_request_id
      AND (
        pcr.assigned_capture_user_id = auth.uid()
        OR pcr.requested_by_user_id = auth.uid()
        OR public.can_operate_cash_branch(auth.uid(), pcr.branch_id)
        OR public.can_manage_branch_admin(auth.uid(), pcr.branch_id)
      )
  )
);

DROP POLICY IF EXISTS "Users can insert payment proofs" ON public.payment_proofs;
CREATE POLICY "Users can insert payment proofs"
ON public.payment_proofs
FOR INSERT
TO authenticated
WITH CHECK (
  uploaded_by_user_id = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM public.payment_capture_requests pcr
    WHERE pcr.id = payment_proofs.capture_request_id
      AND pcr.payment_id = payment_proofs.payment_id
      AND (
        pcr.assigned_capture_user_id = auth.uid()
        OR public.can_operate_cash_branch(auth.uid(), pcr.branch_id)
        OR public.can_manage_branch_admin(auth.uid(), pcr.branch_id)
      )
  )
);

DROP POLICY IF EXISTS "Users can update payment proofs" ON public.payment_proofs;
CREATE POLICY "Users can update payment proofs"
ON public.payment_proofs
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.payment_capture_requests pcr
    WHERE pcr.id = payment_proofs.capture_request_id
      AND (
        pcr.assigned_capture_user_id = auth.uid()
        OR pcr.requested_by_user_id = auth.uid()
        OR public.can_operate_cash_branch(auth.uid(), pcr.branch_id)
        OR public.can_manage_branch_admin(auth.uid(), pcr.branch_id)
      )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.payment_capture_requests pcr
    WHERE pcr.id = payment_proofs.capture_request_id
      AND (
        pcr.assigned_capture_user_id = auth.uid()
        OR pcr.requested_by_user_id = auth.uid()
        OR public.can_operate_cash_branch(auth.uid(), pcr.branch_id)
        OR public.can_manage_branch_admin(auth.uid(), pcr.branch_id)
      )
  )
);

DO $$
BEGIN
  PERFORM pg_notify('pgrst', 'reload schema');
EXCEPTION
  WHEN OTHERS THEN
    NULL;
END;
$$;
