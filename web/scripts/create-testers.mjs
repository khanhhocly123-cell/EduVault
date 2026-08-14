import { register } from "../backend.mjs";

const password=process.env.EDUVAULT_TESTER_PASSWORD;
if(!password || password.length<12)throw new Error("Đặt EDUVAULT_TESTER_PASSWORD tối thiểu 12 ký tự");
for(let i=1;i<=5;i++){
  const email=`tester${String(i).padStart(2,"0")}@eduvault.local`;
  try{
    const result=await register({email,password,name:`EduVault Tester ${i}`,plan:"plus"});
    console.log(`created ${result.user.email}`);
  }catch(error){
    if(error.status===409)console.log(`exists ${email}`);else throw error;
  }
}
