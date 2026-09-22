CREATE TABLE raw_forms (
    id uuid PRIMARY KEY,
    payload jsonb NOT NULL,
    payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
    status text NOT NULL DEFAULT 'received'
        CHECK (status IN ('received', 'ingested', 'duplicate', 'conflict', 'invalid')),
    accepted_raw_form_id uuid REFERENCES raw_forms(id),
    CONSTRAINT raw_forms_accepted_owner_check CHECK (
        (status IN ('duplicate', 'conflict')) = (accepted_raw_form_id IS NOT NULL)
    ),
    error_message text,
    last_attempted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ingested_forms (
    application_reference text PRIMARY KEY,
    raw_form_id uuid NOT NULL UNIQUE REFERENCES raw_forms(id),
    session_id text NOT NULL,
    name text NOT NULL
        CONSTRAINT ingested_forms_name_check
        CHECK (name ~ '^[^[:space:]]+( [^[:space:]]+)+$'),
    email text NOT NULL,
    gender text NOT NULL CHECK (gender IN ('male', 'female', 'other')),
    date_of_birth date NOT NULL,
    phone_number text,
    mobile_number text NOT NULL,
    address_line_1 text NOT NULL,
    address_line_2 text NOT NULL,
    address_line_3 text,
    postcode text NOT NULL,
    country text NOT NULL,
    processing_status text NOT NULL DEFAULT 'pending'
        CHECK (processing_status IN (
            'pending',
            'awaiting_notification',
            'complete',
            'invalid',
            'failed'
        )),
    processing_error text,
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    last_attempted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE transformed_forms (
    application_reference text PRIMARY KEY REFERENCES ingested_forms(application_reference),
    session_id text NOT NULL,
    first_name text NOT NULL
        CONSTRAINT transformed_forms_first_name_check
        CHECK (first_name ~ '^[^[:space:]]+$'),
    last_name text NOT NULL
        CONSTRAINT transformed_forms_last_name_check
        CHECK (last_name ~ '^[^[:space:]]+( [^[:space:]]+)*$'),
    email text NOT NULL,
    gender text NOT NULL CHECK (gender IN ('male', 'female', 'prefer-not-to-say')),
    date_of_birth date NOT NULL,
    phone_number text,
    mobile_number text NOT NULL,
    address_line_1 text NOT NULL,
    address_line_2 text NOT NULL,
    address_line_3 text,
    postcode text NOT NULL,
    country text NOT NULL,
    longitude double precision NOT NULL,
    latitude double precision NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
