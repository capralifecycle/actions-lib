import sys
import os
import yaml
import glob
import re
input_file = sys.argv[1]
start_pattern="<!-- ACTION_TABLE_START -->"
end_pattern="<!-- ACTION_TABLE_END -->"
f = open(input_file, "r")
file_data = f.read()
f.close()
data = {}
for file_path in glob.glob('**/action.yml', recursive=True):
    with open(file_path, 'r') as file:
        yaml_content = yaml.safe_load(file)
        parent_dir_name=os.path.basename(os.path.dirname(file_path))
        data[parent_dir_name] = {
            **yaml.safe_load(yaml_content["description"]),
            "path": file_path
        }
action_table_rows = "\n".join(f"| [{name}]({action['path']}) | {action['description']} | {'✅' if action['local'] else '❌'} |" for name, action in dict(sorted(data.items())).items())
action_table = f'''\
| Action | Description | Local usage |
| --- | --- | --- |
{action_table_rows}\
'''
sys.stdout.write(re.sub(f"{start_pattern}.*{end_pattern}", f"{start_pattern}\n{action_table}\n{end_pattern}", file_data, flags=re.DOTALL))
