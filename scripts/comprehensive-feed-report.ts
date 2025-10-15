/**
 * Comprehensive Feed Report
 * Shows the full status of all 106 missing GUIDs
 */

import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const prisma = new PrismaClient();

// All 106 missing GUIDs from find-missing-albums.ts
const ALL_MISSING_GUIDS = [
  '00addc23-7769-5471-bb9a-c0acb6f27437',
  '00bcaba4-6e91-471f-bb1c-e03950f6ad1d',
  '04ae4785-0c5f-4532-8425-0c6c619a51a5',
  '05b4cf50-f79b-4296-9f04-02c9223182c5',
  '08604071-83cc-5810-bec2-bea0f0cd0033',
  '0934bb2d-210c-4988-8055-9cd54c9817f7',
  '0a131404-899f-4a7d-a2f3-3dbb61622887',
  '0bb8c9c7-1c55-4412-a517-572a98318921',
  '105198e7-c419-4bf3-b099-c968a0821f6f',
  '141b86d8-76bc-581a-adf1-2f836a4dde91',
  '169e65e4-c3fa-471f-a473-b75f3890848b',
  '19803acd-4989-4482-86f7-030ad1533dd8',
  '1aeccb22-0dce-57e8-80fb-01053f506763',
  '1bb0f289-877b-5460-ab92-f8e25a2d4c89',
  '1c7917cc-357c-4eaf-ab54-1a7cda504976',
  '1e7ed1fa-0456-5860-9b34-825d1335d8f8',
  '1f6b5b3e-2a8f-403f-92a1-e632bc1b2b43',
  '209339e5-4dc0-4715-8d3d-2b9bcdd74547',
  '21cedfec-5453-4d6a-89c8-328752b486ee',
  '2663f4e8-aa52-4398-89e7-d26381b65545',
  '286ed5e4-381a-4a6c-abb8-926df3149afe',
  '2907d493-0eeb-4e37-b2eb-929d98427a66',
  '2b62ef49-fcff-523c-b81a-0a7dde2b0609',
  '2eaca3b6-089f-4083-8805-72ff092bab32',
  '3074902b-b2dc-5877-bfc3-30f5df0fbe6a',
  '328f61b9-20b1-4338-9e2a-b437abc39f7b',
  '33eeda7e-8591-4ff5-83f8-f36a879b0a09',
  '3679b281-4f40-5463-aa5a-6ea91b8a4957',
  '3d929593-c368-5a59-aefd-50ec8d788874',
  '41aace28-8679-5ef1-9958-75cf76c2b5f0',
  '47768d25-74d9-5ba4-82db-aeaa7f50e29c',
  '49fdff1d-7c8e-4908-9a75-2edc4ba60fef',
  '4a0dac66-22c0-49f9-9ec2-bcfdf4b4ef10',
  '4a483a4b-867c-50d5-a61a-e99fe03ea57e',
  '4ab3741a-4a10-5631-a026-a9d0eb62fe11',
  '4e3cd92d-d36b-42d5-8333-824901160fac',
  '51606506-66f8-4394-b6c6-cc0c1b554375',
  '5781d087-66d8-4c54-88de-0141405e3022',
  '5890a4d1-0f8f-45e9-ad46-72bf6f79853d',
  '5917663e-8d6e-45be-a364-01dfcdd26b4f',
  '5a07b3f1-8249-45a1-b40a-630797dc4941',
  '5a95f9d8-35e3-51f5-a269-ba1df36b4bd8',
  '618e9f64-fd34-4af7-bbe8-2d4c24e87ba8',
  '6529270e-9beb-41e3-a870-b74470cd272e',
  '699644a5-a5b4-4c2d-ad70-e90977e60c34',
  '69c634ad-afea-5826-ad9a-8e1f06d6470b',
  '6b7793b8-fd9d-432b-af1a-184cd41aaf9d',
  '6bece1b8-5385-4a33-9224-09e7f3ee6965',
  '6bf3785f-e053-57f4-9f70-261ee5e3747f',
  '6eef0b66-bb86-5d0c-b260-099bcc920b7c',
  '6f724ceb-0688-40d5-a93f-4d0b6ec1c797',
  '6f9ec822-9e9c-497d-b90a-f49035a40f0f',
  '704d0994-a102-4d6b-9c54-d22364e2e68d',
  '733fe358-6754-4135-a640-d75bc704c85d',
  '79f5f4f0-a774-40ed-abdf-90ada1980a71',
  '7c295d64-8b85-4b4f-be2c-72f3954fdcaa',
  '802fd4e4-6d5b-4003-a204-27cd0c536811',
  '81351a09-d1f8-46a4-85c0-f7cb32223d64',
  '82700713-4ecc-4fc1-94d9-2c0b765504eb',
  '85d3062e-d2de-48dd-8d9e-4a17b8728ae5',
  '87a7ebee-2bce-47f5-90eb-950702e3e7a3',
  '87c4f77c-f400-4548-bb7d-78f1ec8a7fa9',
  '8aaf0d1e-7ac3-4f7d-993b-6f59f936d780',
  '8c5dd9fd-4257-5e7b-9e94-643e6aa4ca1c',
  '910874e0-86cc-5d95-9589-a9948c32880a',
  '94c8a0bf-f76e-5f8c-ba1d-c0c15a642271',
  '95ea253a-4058-402c-8503-204f6d3f1494',
  '99ed143c-c461-4f1a-9d0d-bee6f70d8b7e',
  '9e673dbf-0c6e-49f1-85fa-5b3bdd9b9f08',
  'a0c0f339-bacc-45a1-aea5-1384468c7b9a',
  'a3d6d7d5-4b5d-5161-b119-cf5e99d35fda',
  'a40615ac-1b3c-5c76-8961-6bbc86e20439',
  'ad40401b-def9-4c89-b2e5-f47b67254d65',
  'af09e07f-a8d5-436f-a20d-d1a16ae4f737',
  'af99d1b4-e10e-503f-8321-8d748bdc76f8',
  'b337bd2b-46c5-4bd0-a57f-f93bca81ebea',
  'b7f90468-3cce-47c1-90e7-fef3217987e2',
  'b84c3345-55db-54e0-ac41-4b1cc6f3df67',
  'bba99401-378c-5540-bf95-c456b3d4de26',
  'c2095619-a9d0-5e7c-80e1-59e520ce55d3',
  'c5b7d7f5-bf48-41c7-b0cc-8139e300185e',
  'c5cc9864-c687-4c6d-937d-0aa5f103a8d2',
  'c76ef0a6-0181-5b9b-a4bc-dd85d4ed178b',
  'd0bebcfa-e20b-4b1b-b797-bd7ac95e646f',
  'd13eab76-a4c4-5e4b-a0fb-25ed1386bc51',
  'd1b0d4a2-9cc7-405e-b10e-4c96267f902b',
  'd3ee6d16-fc74-4661-a810-4059f745426d',
  'd4608e6e-024c-5482-befc-7bee3753167d',
  'd4f791c3-4d0c-4fbd-a543-c136ee78a9de',
  'd7a1d7bc-ae06-4b3b-a3fa-4e203d68dbaf',
  'dbec0da2-f2a0-43e1-b76c-8779ebf595a8',
  'de196d3e-276d-5b5f-aa30-34d747e5f6a7',
  'df55d16a-a519-469a-9702-912f92d50389',
  'e0658b29-1cd3-55b8-ac51-0997764ce334',
  'e1f9dfcb-ee9b-4a6d-aee7-189043917fb5',
  'e2d6766a-5c28-5cbd-b678-4d7595646e4e',
  'e678589b-5a9f-4918-9622-34119d2eed2c',
  'e6a50ff6-8e1b-445f-a9ef-21096af86e49',
  'e954a4c4-69d2-4ac3-8b86-fe5469f6c9df',
  'e9a8cb88-42a0-4a02-93dc-02ddd51f1b73',
  'e9ae5762-130d-4a16-b8b2-98804cc1802e',
  'ec5905f8-0f48-4ce8-ab8e-9a4a959a2104',
  'ed5ba51a-7b87-4a67-81a4-71f64b71c5f3',
  'f275657c-4b58-563a-ad3b-91b65035b3d8',
  'f6bbce4b-4d7a-42ba-9464-6a870b4a387e',
  'f7d933c8-032a-52e5-9598-e34d833a3e8e',
];

async function generateReport() {
  console.log('📊 Comprehensive Feed Status Report\n');
  console.log('='.repeat(70));

  const withError: Array<{ guid: string; title: string; artist: string }> = [];
  const notInDB: string[] = [];

  for (const guid of ALL_MISSING_GUIDS) {
    const feedUrl = `https://wavlake.com/feed/music/${guid}`;

    const feed = await prisma.feed.findFirst({
      where: {
        originalUrl: feedUrl,
        type: 'album'
      },
      select: {
        title: true,
        artist: true,
        status: true
      }
    });

    if (feed) {
      withError.push({ guid, title: feed.title || 'Unknown', artist: feed.artist || 'Unknown' });
    } else {
      notInDB.push(guid);
    }
  }

  console.log(`\n📊 Summary:`);
  console.log(`   Total GUIDs analyzed: ${ALL_MISSING_GUIDS.length}`);
  console.log(`   In database (status='error'): ${withError.length}`);
  console.log(`   Not in Podcast Index: ${notInDB.length}\n`);

  console.log('='.repeat(70));
  console.log(`\n✅ Feeds in database with status='error' (${withError.length}):`);
  console.log('   These feeds were attempted but failed during previous sync\n');
  withError.forEach(f => {
    console.log(`   ${f.guid}`);
    console.log(`   └─ ${f.title} by ${f.artist}\n`);
  });

  console.log('='.repeat(70));
  console.log(`\n❌ Feeds NOT in Podcast Index (${notInDB.length}):`);
  console.log('   These feeds cannot be synced (deleted/private/not indexed)\n');
  notInDB.forEach(guid => {
    console.log(`   https://wavlake.com/feed/music/${guid}`);
  });

  await prisma.$disconnect();
}

generateReport().catch(error => {
  console.error('Error:', error);
  prisma.$disconnect();
  process.exit(1);
});
