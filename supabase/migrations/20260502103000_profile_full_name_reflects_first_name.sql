CREATE OR REPLACE FUNCTION public.sync_profile_full_name()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_clean_full_name text;
  v_parts text[];
BEGIN
  NEW.first_name := NULLIF(trim(regexp_replace(COALESCE(NEW.first_name, ''), '[[:space:]]+', ' ', 'g')), '');
  NEW.last_name := NULLIF(trim(regexp_replace(COALESCE(NEW.last_name, ''), '[[:space:]]+', ' ', 'g')), '');

  IF NEW.first_name IS NULL THEN
    v_clean_full_name := NULLIF(trim(regexp_replace(COALESCE(NEW.full_name, ''), '[[:space:]]+', ' ', 'g')), '');

    IF v_clean_full_name IS NOT NULL THEN
      v_parts := regexp_split_to_array(v_clean_full_name, ' ');
      NEW.first_name :=
        CASE
          WHEN array_length(v_parts, 1) > 1 THEN array_to_string(v_parts[1:(array_length(v_parts, 1) - 1)], ' ')
          ELSE v_clean_full_name
        END;

      IF NEW.last_name IS NULL AND array_length(v_parts, 1) > 1 THEN
        NEW.last_name := v_parts[array_length(v_parts, 1)];
      END IF;
    END IF;
  END IF;

  NEW.first_name := COALESCE(NEW.first_name, 'Usuario');
  NEW.last_name := COALESCE(NEW.last_name, 'Sin Apellido');
  NEW.full_name := NEW.first_name;

  RETURN NEW;
END;
$$;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_full_name_letters_only,
  DROP CONSTRAINT IF EXISTS profiles_first_name_letters_only,
  DROP CONSTRAINT IF EXISTS profiles_last_name_letters_only;

UPDATE public.profiles
SET full_name = first_name
WHERE full_name IS DISTINCT FROM first_name;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_full_name_letters_only
  CHECK (full_name ~ '^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ[:space:]]+$') NOT VALID,
  ADD CONSTRAINT profiles_first_name_letters_only
  CHECK (first_name ~ '^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ[:space:]]+$') NOT VALID,
  ADD CONSTRAINT profiles_last_name_letters_only
  CHECK (last_name ~ '^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ[:space:]]+$') NOT VALID;
