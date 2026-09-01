#!/bin/bash

# Get array of workspaces
# convert NDJSON stream to an array of arrays, divided by chunk size
# The reason we do a conditional here is that github actions thinks that there is
# a secret present with the output of this and therefore refuses to share data between jobs
if [ -z "${CHUNKS}" ]; then
  export CHUNKS=$(pnpm list -r --depth -1 --json | jq -cM '[.[] | .name] | [_nwise(length / 2 | ceil)]')
fi

# get the workspaces of the current CHUNK environment
workspaces=$(echo $CHUNKS | jq -r ".[$CHUNK]")

echo "workspaces - $workspaces"
# Initialize an empty string for the filters
filters=""

# Loop through each workspace in the array
for workspace in $(echo "$workspaces" | jq -r '.[]'); do
  # Add the workspace name to the filters array as an argument
  filters+=" --filter=${workspace}"
done

command="pnpm $filters test $@"
# Run the test in the selected chunk
eval "$command"
