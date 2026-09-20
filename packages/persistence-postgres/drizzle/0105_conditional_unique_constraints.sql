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
            and (("fx_control_unique_constraint_definition"."physical_spec_json" -> 'predicate') - 'kind' - 'field') = '{}'::jsonb
            and "fx_control_unique_constraint_definition"."physical_spec_json" -> 'predicate' ->> 'kind' = 'fieldIsNull'
            and jsonb_typeof("fx_control_unique_constraint_definition"."physical_spec_json" -> 'predicate' -> 'field') = 'string'
            and length("fx_control_unique_constraint_definition"."physical_spec_json" -> 'predicate' ->> 'field') > 0
          ))
        ) is true
      );
