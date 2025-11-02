#!/usr/bin/env node

/**
 * Test script to verify the regex fix for podcast:valueRecipient parsing
 */

function testRegexFix() {
  console.log('🧪 Testing regex fix for podcast:valueRecipient parsing...\n');

  // Test XML content with opening/closing tags (like RSS Blue feeds)
  const testXML = `<podcast:value type="lightning" method="keysend">
      <podcast:valueRecipient name="Emily Ronna" customKey="906608" customValue="01KZ2f13T5kZjfmuKzILsl" type="node" address="03b6f613e88bd874177c28c6ad83b3baba43c4c656f56be1f8df84669556054b79" split="4508"></podcast:valueRecipient>
      <podcast:valueRecipient name="Phantom Power Music" customKey="696969" customValue="aBpWlXR7oKOAYjr21Elk" type="node" address="030a58b8653d32b99200a2334cfe913e51dc7d155aa0116c176657a4f1722677a3" split="245"></podcast:valueRecipient>
      <podcast:valueRecipient name="RSS Blue" type="node" address="02d256a6f93e3d4f95db0d9b3e85bc49f8c61a15b6e9c59e946d1b2806a87f6eb7" split="97"></podcast:valueRecipient>
    </podcast:value>`;

  // Extract the value content (between podcast:value tags)
  const valueRegex = /<podcast:value[^>]*>(.*?)<\/podcast:value>/gs;
  const valueMatch = valueRegex.exec(testXML);
  
  if (!valueMatch) {
    console.log('❌ No podcast:value tags found');
    return;
  }
  
  const valueContent = valueMatch[1];
  console.log('📋 Value content:', valueContent);
  
  // Test OLD regex (self-closing only)
  console.log('\n🔍 Testing OLD regex (self-closing only):');
  const oldRecipientRegex = /<podcast:valueRecipient[^>]*\/>/g;
  const oldMatches = [];
  let oldMatch;
  while ((oldMatch = oldRecipientRegex.exec(valueContent)) !== null) {
    oldMatches.push(oldMatch[0]);
  }
  console.log('OLD regex matches:', oldMatches.length, oldMatches);
  
  // Test NEW regex (both self-closing and opening/closing)
  console.log('\n🔍 Testing NEW regex (both formats):');
  const newRecipientRegex = /<podcast:valueRecipient[^>]*(?:\/>|><\/podcast:valueRecipient>)/g;
  const newMatches = [];
  let newMatch;
  while ((newMatch = newRecipientRegex.exec(valueContent)) !== null) {
    newMatches.push(newMatch[0]);
  }
  console.log('NEW regex matches:', newMatches.length, newMatches);
  
  // Test parsing recipients
  console.log('\n🔍 Testing recipient parsing:');
  newMatches.forEach((match, index) => {
    console.log(`\nRecipient ${index + 1}:`);
    console.log('  Raw tag:', match);
    
    const nameMatch = match.match(/name="([^"]*)"/);
    const addressMatch = match.match(/address="([^"]*)"/);
    const typeMatch = match.match(/type="([^"]*)"/);
    const splitMatch = match.match(/split="([^"]*)"/);
    
    console.log('  Name:', nameMatch ? nameMatch[1] : 'not found');
    console.log('  Address:', addressMatch ? addressMatch[1] : 'not found');
    console.log('  Type:', typeMatch ? typeMatch[1] : 'not found');
    console.log('  Split:', splitMatch ? splitMatch[1] : 'not found');
  });
  
  console.log('\n✅ Test completed!');
}

testRegexFix();
