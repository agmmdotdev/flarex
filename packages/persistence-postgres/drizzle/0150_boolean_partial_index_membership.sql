ALTER TABLE "fx_control_index_definition" DROP CONSTRAINT "fx_control_index_definition_spec_json_check";--> statement-breakpoint
ALTER TABLE "fx_control_index_definition" ADD CONSTRAINT "fx_control_index_definition_spec_json_check" CHECK (
        (
          jsonb_typeof("fx_control_index_definition"."physical_spec_json") = 'object'
          and octet_length("fx_control_index_definition"."physical_spec_json"::text) between 1 and 131072
          and ("fx_control_index_definition"."physical_spec_json" - 'accessPath' - 'collation'
            - 'keyCodecVersion' - 'kind' - 'maxEncodedKeyBytes'
            - 'orderedFields' - 'specVersion' - 'tieBreaker' - 'predicate') = '{}'::jsonb
          and "fx_control_index_definition"."physical_spec_json" ->> 'kind' = 'appOrdered'
          and "fx_control_index_definition"."physical_spec_json" -> 'specVersion' = '1'::jsonb
          and "fx_control_index_definition"."physical_spec_json" ->> 'accessPath' = "fx_control_index_definition"."access_kind"
          and "fx_control_index_definition"."physical_spec_json" -> 'keyCodecVersion' = '1'::jsonb
          and "fx_control_index_definition"."physical_spec_json" ->> 'collation' = 'binaryUtf8'
          and "fx_control_index_definition"."physical_spec_json" -> 'maxEncodedKeyBytes' = '2048'::jsonb
          and jsonb_typeof("fx_control_index_definition"."physical_spec_json" -> 'orderedFields') = 'array'
          and "fx_control_index_definition"."physical_spec_json" -> 'tieBreaker'
            = '{"byteLength":16,"kind":"separateRowIdentity"}'::jsonb
          and (not ("fx_control_index_definition"."physical_spec_json" ? 'predicate') or (
            "fx_control_index_definition"."access_kind" = 'developer'
            and jsonb_typeof("fx_control_index_definition"."physical_spec_json" -> 'predicate') = 'object'
            and (
              ((("fx_control_index_definition"."physical_spec_json" -> 'predicate') - 'kind' - 'field') = '{}'::jsonb
                and "fx_control_index_definition"."physical_spec_json" -> 'predicate' ->> 'kind' = 'fieldIsNull'
                and jsonb_typeof("fx_control_index_definition"."physical_spec_json" -> 'predicate' -> 'field') = 'string'
                and length("fx_control_index_definition"."physical_spec_json" -> 'predicate' ->> 'field') > 0)
              or
              ((("fx_control_index_definition"."physical_spec_json" -> 'predicate') - 'kind' - 'nullField' - 'textField' - 'value') = '{}'::jsonb
                and "fx_control_index_definition"."physical_spec_json" -> 'predicate' ->> 'kind' = 'fieldIsNullAndTextEquals'
                and jsonb_typeof("fx_control_index_definition"."physical_spec_json" -> 'predicate' -> 'nullField') = 'string'
                and length("fx_control_index_definition"."physical_spec_json" -> 'predicate' ->> 'nullField') > 0
                and jsonb_typeof("fx_control_index_definition"."physical_spec_json" -> 'predicate' -> 'textField') = 'string'
                and length("fx_control_index_definition"."physical_spec_json" -> 'predicate' ->> 'textField') > 0
                and jsonb_typeof("fx_control_index_definition"."physical_spec_json" -> 'predicate' -> 'value') = 'string'
                and length("fx_control_index_definition"."physical_spec_json" -> 'predicate' ->> 'value') between 1 and 256)
              or
              ((("fx_control_index_definition"."physical_spec_json" -> 'predicate') - 'kind' - 'nullField' - 'booleanField' - 'value') = '{}'::jsonb
                and "fx_control_index_definition"."physical_spec_json" -> 'predicate' ->> 'kind' = 'fieldIsNullAndBooleanEquals'
                and jsonb_typeof("fx_control_index_definition"."physical_spec_json" -> 'predicate' -> 'nullField') = 'string'
                and length("fx_control_index_definition"."physical_spec_json" -> 'predicate' ->> 'nullField') > 0
                and jsonb_typeof("fx_control_index_definition"."physical_spec_json" -> 'predicate' -> 'booleanField') = 'string'
                and length("fx_control_index_definition"."physical_spec_json" -> 'predicate' ->> 'booleanField') > 0
                and "fx_control_index_definition"."physical_spec_json" -> 'predicate' ->> 'nullField' <> "fx_control_index_definition"."physical_spec_json" -> 'predicate' ->> 'booleanField'
                and jsonb_typeof("fx_control_index_definition"."physical_spec_json" -> 'predicate' -> 'value') = 'boolean')
            )
          ))
        ) is true
      );
--> statement-breakpoint
ALTER TABLE "fx_control_unique_constraint_definition" DROP CONSTRAINT "fx_control_unique_constraint_definition_spec_json_check";--> statement-breakpoint
ALTER TABLE "fx_control_unique_constraint_definition" ADD CONSTRAINT "fx_control_unique_constraint_definition_spec_json_check" CHECK (
        (
          jsonb_typeof("fx_control_unique_constraint_definition"."physical_spec_json") = 'object'
          and octet_length("fx_control_unique_constraint_definition"."physical_spec_json"::text) between 1 and 131072
          and ("fx_control_unique_constraint_definition"."physical_spec_json" - 'keyCodecIdentity'
            - 'keyCodecVersion' - 'kind' - 'localePolicy'
            - 'orderedFields' - 'sparse' - 'specVersion' - 'predicate' - 'nullsDistinct') = '{}'::jsonb
          and "fx_control_unique_constraint_definition"."physical_spec_json" ->> 'kind' = 'appUniqueConstraint'
          and "fx_control_unique_constraint_definition"."physical_spec_json" -> 'specVersion' = '1'::jsonb
          and "fx_control_unique_constraint_definition"."physical_spec_json" ->> 'keyCodecIdentity'
            = 'flarex.unique-key/ordered-index-components/v1'
          and "fx_control_unique_constraint_definition"."physical_spec_json" -> 'keyCodecVersion' = '1'::jsonb
          and "fx_control_unique_constraint_definition"."physical_spec_json" -> 'localePolicy'
            = '{"kind":"none"}'::jsonb
          and jsonb_typeof("fx_control_unique_constraint_definition"."physical_spec_json" -> 'orderedFields') = 'array'
          and jsonb_array_length("fx_control_unique_constraint_definition"."physical_spec_json" -> 'orderedFields')
            between 1 and 15
          and jsonb_typeof("fx_control_unique_constraint_definition"."physical_spec_json" -> 'sparse') = 'boolean'
          and (not ("fx_control_unique_constraint_definition"."physical_spec_json" ? 'nullsDistinct')
            or "fx_control_unique_constraint_definition"."physical_spec_json" -> 'nullsDistinct' = 'true'::jsonb)
          and (not ("fx_control_unique_constraint_definition"."physical_spec_json" ? 'predicate') or (
            jsonb_typeof("fx_control_unique_constraint_definition"."physical_spec_json" -> 'predicate') = 'object'
            and (((("fx_control_unique_constraint_definition"."physical_spec_json" -> 'predicate') - 'kind' - 'field') = '{}'::jsonb
            and "fx_control_unique_constraint_definition"."physical_spec_json" -> 'predicate' ->> 'kind' = 'fieldIsNull'
            and jsonb_typeof("fx_control_unique_constraint_definition"."physical_spec_json" -> 'predicate' -> 'field') = 'string'
            and length("fx_control_unique_constraint_definition"."physical_spec_json" -> 'predicate' ->> 'field') > 0)
            or
            ((("fx_control_unique_constraint_definition"."physical_spec_json" -> 'predicate') - 'kind' - 'nullField' - 'booleanField' - 'value') = '{}'::jsonb
              and "fx_control_unique_constraint_definition"."physical_spec_json" -> 'predicate' ->> 'kind' = 'fieldIsNullAndBooleanEquals'
              and jsonb_typeof("fx_control_unique_constraint_definition"."physical_spec_json" -> 'predicate' -> 'nullField') = 'string'
              and length("fx_control_unique_constraint_definition"."physical_spec_json" -> 'predicate' ->> 'nullField') > 0
              and jsonb_typeof("fx_control_unique_constraint_definition"."physical_spec_json" -> 'predicate' -> 'booleanField') = 'string'
              and length("fx_control_unique_constraint_definition"."physical_spec_json" -> 'predicate' ->> 'booleanField') > 0
              and "fx_control_unique_constraint_definition"."physical_spec_json" -> 'predicate' ->> 'nullField' <> "fx_control_unique_constraint_definition"."physical_spec_json" -> 'predicate' ->> 'booleanField'
              and jsonb_typeof("fx_control_unique_constraint_definition"."physical_spec_json" -> 'predicate' -> 'value') = 'boolean'))
          ))
        ) is true
      );
