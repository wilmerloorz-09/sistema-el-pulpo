const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function checkAdmin2() {
  const { data: profiles, error: profileErr } = await supabase
    .from('profiles')
    .select('*')
    .eq('username', 'admin2');
    
  if (profileErr) {
    console.error('Error fetching profile:', profileErr);
    return;
  }
  
  if (!profiles || profiles.length === 0) {
    console.log('@admin2 not found in profiles.');
    return;
  }
  
  const admin2 = profiles[0];
  console.log('Profile:', admin2);
  
  const { data: globalRoles } = await supabase
    .from('user_global_roles')
    .select('*, roles(*)')
    .eq('user_id', admin2.id);
  
  console.log('Global roles:', JSON.stringify(globalRoles, null, 2));
  
  const { data: branchRoles } = await supabase
    .from('user_branch_roles')
    .select('*, roles(*)')
    .eq('user_id', admin2.id);
    
  console.log('Branch roles:', JSON.stringify(branchRoles, null, 2));

  const { data: userBranches } = await supabase
    .from('user_branches')
    .select('*')
    .eq('user_id', admin2.id);

  console.log('User branches:', JSON.stringify(userBranches, null, 2));
}

checkAdmin2();
