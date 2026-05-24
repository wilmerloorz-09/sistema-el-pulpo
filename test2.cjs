const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
async function run() {
  const p_branch_id = '019ef496-e929-4695-b199-6502103ad5d9';
  const { data: users, error } = await supabase.from('profiles').select('*').eq('is_active', true);
  if (error) { console.error(error); return; }

  const { data: globalRoles } = await supabase.from('user_global_roles').select('*, roles(*)').eq('is_active', true);
  const { data: branchRoles } = await supabase.from('user_branch_roles').select('*, roles(*)').eq('is_active', true);
  const { data: branches } = await supabase.from('user_branches').select('*').eq('branch_id', p_branch_id);

  let allowedUsers = [];

  for (let p of users) {
    let inBranch = branches.some(b => b.user_id === p.id);
    
    let isGlobalAdmin = globalRoles.some(ugr => ugr.user_id === p.id && ugr.roles.code === 'administrador' && ugr.roles.is_active);
    
    let isSupervisorAnywhere = branchRoles.some(ubr => ubr.user_id === p.id && ubr.roles.code === 'supervisor' && ubr.roles.is_active);

    let inThirdUnion = !isGlobalAdmin && !isSupervisorAnywhere;

    if (inBranch || isGlobalAdmin || inThirdUnion) {
      allowedUsers.push({ username: p.username, inBranch, isGlobalAdmin, inThirdUnion, isSupervisorAnywhere });
    }
  }

  console.log("Total returned:", allowedUsers.length);
  console.log(allowedUsers.map(u => u.username).sort());
  console.log("admin2 status:", allowedUsers.find(u => u.username === 'admin2'));
}
run();
