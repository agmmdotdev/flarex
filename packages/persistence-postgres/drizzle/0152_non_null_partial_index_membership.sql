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
                and "fx_control_index_definition"."physical_spec_json" -> 'predicate' ->> 'kind' in ('fieldIsNull', 'fieldIsNotNull')
                and jsonb_typeof("fx_control_index_definition"."physical_spec_json" -> 'predicate' -> 'field') = 'string'
                and length("fx_control_index_definition"."physical_spec_json" -> 'predicate' ->> 'field') > 0)
              or
              ((("fx_control_index_definition"."physical_spec_json" -> 'predicate') - 'kind' - 'nullField' - 'notNullField') = '{}'::jsonb
                and "fx_control_index_definition"."physical_spec_json" -> 'predicate' ->> 'kind' = 'fieldIsNullAndNotNull'
                and jsonb_typeof("fx_control_index_definition"."physical_spec_json" -> 'predicate' -> 'nullField') = 'string'
                and length("fx_control_index_definition"."physical_spec_json" -> 'predicate' ->> 'nullField') > 0
                and jsonb_typeof("fx_control_index_definition"."physical_spec_json" -> 'predicate' -> 'notNullField') = 'string'
                and length("fx_control_index_definition"."physical_spec_json" -> 'predicate' ->> 'notNullField') > 0
                and "fx_control_index_definition"."physical_spec_json" -> 'predicate' ->> 'nullField' <> "fx_control_index_definition"."physical_spec_json" -> 'predicate' ->> 'notNullField')
              or
              ((("fx_control_index_definition"."physical_spec_json" -> 'predicate') - 'kind' - 'fields') = '{}'::jsonb
                and "fx_control_index_definition"."physical_spec_json" -> 'predicate' ->> 'kind' = 'fieldsAreNull'
                and jsonb_typeof("fx_control_index_definition"."physical_spec_json" -> 'predicate' -> 'fields') = 'array'
                and case when jsonb_typeof("fx_control_index_definition"."physical_spec_json" -> 'predicate' -> 'fields') = 'array'
                  then jsonb_array_length("fx_control_index_definition"."physical_spec_json" -> 'predicate' -> 'fields') = 2 else false end
                and jsonb_typeof("fx_control_index_definition"."physical_spec_json" -> 'predicate' -> 'fields' -> 0) = 'string'
                and jsonb_typeof("fx_control_index_definition"."physical_spec_json" -> 'predicate' -> 'fields' -> 1) = 'string'
                and length("fx_control_index_definition"."physical_spec_json" -> 'predicate' -> 'fields' ->> 0) > 0
                and length("fx_control_index_definition"."physical_spec_json" -> 'predicate' -> 'fields' ->> 1) > 0
                and "fx_control_index_definition"."physical_spec_json" -> 'predicate' -> 'fields' ->> 0 <> "fx_control_index_definition"."physical_spec_json" -> 'predicate' -> 'fields' ->> 1)
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
      );--> statement-breakpoint
