ALTER TABLE ingested_forms
    DROP CONSTRAINT ingested_forms_processing_status_check;

ALTER TABLE ingested_forms
    ADD CONSTRAINT ingested_forms_processing_status_check
    CHECK (processing_status IN ('pending', 'transformed', 'complete', 'invalid', 'failed'));
