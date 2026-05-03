import sys

file_path = r'c:\sistema-el-pulpo\src\components\admin\ShiftSetupAdmin.tsx'
with open(file_path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Lines are 1801 to 1807 (1-indexed)
# In 0-indexed: 1800 to 1806
start = 1800
end = 1807

# Verify the content before deleting
target_snippet = "".join(lines[start:end])
if "Editar Ordenes" in target_snippet:
    new_lines = lines[:start] + lines[end:]
    with open(file_path, 'w', encoding='utf-8') as f:
        f.writelines(new_lines)
    print("Successfully removed lines 1801-1807")
else:
    print("Target content not found at expected lines. Content was:")
    print(target_snippet)
    sys.exit(1)
