-- Limpia pagos que quedaron con marcadores contradictorios de comprobante:
-- TRANSFER_PROOF_PENDING:1|TRANSFER_PROOF_PENDING:0.
-- Si existe el marcador :0, el pago ya no debe ser tratado como pendiente.

WITH normalized AS (
  SELECT
    p.id,
    NULLIF(
      string_agg(parts.part, '|' ORDER BY parts.ord)
        FILTER (
          WHERE parts.part <> ''
            AND parts.part NOT LIKE 'TRANSFER_PROOF_PENDING:%'
        ),
      ''
    ) AS base_notes
  FROM public.payments p
  CROSS JOIN LATERAL unnest(string_to_array(COALESCE(p.notes, ''), '|'))
    WITH ORDINALITY AS parts(part, ord)
  WHERE COALESCE(p.notes, '') LIKE '%TRANSFER_PROOF_PENDING:1%'
    AND COALESCE(p.notes, '') LIKE '%TRANSFER_PROOF_PENDING:0%'
  GROUP BY p.id
)
UPDATE public.payments p
SET notes = CASE
  WHEN normalized.base_notes IS NULL THEN 'TRANSFER_PROOF_PENDING:0'
  ELSE normalized.base_notes || '|TRANSFER_PROOF_PENDING:0'
END
FROM normalized
WHERE p.id = normalized.id;

NOTIFY pgrst, 'reload schema';
