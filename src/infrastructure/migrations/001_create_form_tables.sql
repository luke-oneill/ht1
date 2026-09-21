CREATE TABLE ingested_forms (
    application_reference text PRIMARY KEY,
    raw_payload jsonb NOT NULL,
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
    processing_error text,
    last_attempted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE transformed_forms (
    application_reference text PRIMARY KEY REFERENCES ingested_forms(application_reference),
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
