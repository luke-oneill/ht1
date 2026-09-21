CREATE TABLE raw (
    id uuid PRIMARY KEY,
    payload jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ingestions (
    raw_id uuid PRIMARY KEY REFERENCES raw(id),
    status text NOT NULL DEFAULT 'received'
        CHECK (status IN ('received', 'intermediate', 'primary', 'complete', 'duplicate', 'failed')),
    failed_step text,
    error_message text,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE intermediate (
    application_reference text PRIMARY KEY,
    raw_id uuid NOT NULL UNIQUE REFERENCES raw(id),
    session_id text NOT NULL,
    name text NOT NULL,
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
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "primary" (
    application_reference text PRIMARY KEY REFERENCES intermediate(application_reference),
    intermediate_raw_id uuid NOT NULL UNIQUE REFERENCES intermediate(raw_id),
    session_id text NOT NULL,
    first_name text NOT NULL,
    last_name text NOT NULL,
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

CREATE INDEX ingestions_processable_idx
    ON ingestions (updated_at)
    WHERE status IN ('received', 'intermediate', 'primary');
