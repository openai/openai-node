import OpenAI from 'openai';
 import { betaZodFunctionTool } from 'openai/helpers/beta/zod';
 import { z } from 'zod';

 const client = new OpenAI();

 async function main() {
   // Define the schema using oneOf
   const searchSchema = z.object({
     searchCriteria: z.object({
       // This creates a oneOf in the JSON Schema
       criteria: z.union([
         z.object({
           name: z.string().describe('Search by name'),
           type: z.enum(['person', 'product', 'location']).describe('Type of entity to search for')
         }),
         z.object({
           id: z.number().describe('Search by numeric ID'),
           includeDeleted: z.boolean().optional().describe('Whether to include deleted items')
         })
       ])
     })
   });

   const message = await client.beta.chat.completions.toolRunner({
     messages: [
       {
         role: 'user',
         content: `I need to search for something. You can search by either name or ID.`,
       },
     ],
     tools: [
       betaZodFunctionTool({
         name: 'searchDatabase',
         description: 'Search database for items by either name or ID',
         parameters: searchSchema,
         run: (params) => {
           const criteria = params.searchCriteria.criteria;

           if ('name' in criteria) {
             return `Found 3 results for name "${criteria.name}" of type "${criteria.type}"`;
           } else {
             const deletedStatus = criteria.includeDeleted ? ' (including deleted items)' : '';
             return `Found item with ID ${criteria.id}${deletedStatus}`;
           }
         },
       }),
     ],
     model: 'gpt-4o',
     max_tokens: 1024,
     max_iterations: 10,
   });

   console.log('Final response:', message.content);
 }

 main();
