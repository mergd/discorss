#!/usr/bin/env node
/**
 * Local test script for Railway cron restart
 * 
 * Tests the restart script against the real Railway API.
 * Usage: RAILWAY_API_TOKEN=your-token BOT_SERVICE_ID=service-id bun test-cron-restart.js
 */

const RAILWAY_API_TOKEN = process.env.RAILWAY_API_TOKEN;
const SERVICE_ID = process.env.BOT_SERVICE_ID;

if (!RAILWAY_API_TOKEN) {
    console.error('❌ Error: RAILWAY_API_TOKEN must be set');
    process.exit(1);
}

if (!SERVICE_ID) {
    console.error('❌ Error: BOT_SERVICE_ID must be set');
    process.exit(1);
}

const API_URL = 'https://backboard.railway.app/graphql/v2';

console.log(`\n🚀 Testing Railway API restart`);
console.log(`   API URL: ${API_URL}`);
console.log(`   Service ID: ${SERVICE_ID}`);
console.log(`   Token: ${RAILWAY_API_TOKEN.substring(0, 20)}...\n`);

async function queryServices() {
    const query = `
        query {
            me {
                projects {
                    edges {
                        node {
                            id
                            name
                            services {
                                edges {
                                    node {
                                        id
                                        name
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    `;

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${RAILWAY_API_TOKEN}`,
            },
            body: JSON.stringify({ query }),
        });

        const result = await response.json();
        if (result.data) {
            console.log(`\n📋 Available services:`);
            result.data.me.projects.edges.forEach(project => {
                console.log(`   Project: ${project.node.name} (${project.node.id})`);
                project.node.services.edges.forEach(service => {
                    const isMatch = service.node.id === SERVICE_ID ? ' ← CURRENT' : '';
                    console.log(`     - ${service.node.name}: ${service.node.id}${isMatch}`);
                });
            });
            console.log();
        }
    } catch (error) {
        console.log(`   ⚠️  Could not query services: ${error.message}`);
    }
}

async function runTest() {
    await queryServices();

    const mutations = [
        {
            name: 'serviceRestart',
            query: `
                mutation serviceRestart($id: String!) {
                    serviceRestart(id: $id)
                }
            `,
            variables: { id: SERVICE_ID },
        },
        {
            name: 'serviceRedeploy',
            query: `
                mutation serviceRedeploy($serviceId: String!) {
                    serviceRedeploy(serviceId: $serviceId)
                }
            `,
            variables: { serviceId: SERVICE_ID },
        },
        {
            name: 'serviceInstanceRedeploy',
            query: `
                mutation serviceInstanceRedeploy($serviceId: String!) {
                    serviceInstanceRedeploy(serviceId: $serviceId)
                }
            `,
            variables: { serviceId: SERVICE_ID },
        },
    ];

    for (const mutation of mutations) {
        try {
            console.log(`\n🔍 Trying mutation: ${mutation.name}`);
            
            const response = await fetch(API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${RAILWAY_API_TOKEN}`,
                },
                body: JSON.stringify({
                    query: mutation.query,
                    variables: mutation.variables,
                }),
            });

            const responseText = await response.text();
            console.log(`   Status: ${response.status} ${response.statusText}`);
            console.log(`   Response:`, responseText.substring(0, 200));
            
            if (!response.ok) {
                console.log(`   ❌ Failed with status ${response.status}`);
                continue;
            }

            const result = JSON.parse(responseText);

            if (result.errors) {
                console.log(`   ❌ GraphQL errors:`, JSON.stringify(result.errors, null, 2));
                continue;
            }

            console.log(`   ✅ Success!`);
            console.log(`   Result:`, JSON.stringify(result.data, null, 2));
            process.exit(0);
        } catch (error) {
            console.log(`   ❌ Error:`, error.message);
            if (error.stack) {
                console.log(`   Stack:`, error.stack.split('\n').slice(0, 3).join('\n'));
            }
            continue;
        }
    }

    console.error(`\n❌ All mutation attempts failed`);
    console.error(`   Service ID used: ${SERVICE_ID}`);
    console.error(`\n💡 Tips:`);
    console.error(`   - Verify the service ID is correct`);
    console.error(`   - Check that the API token has proper permissions`);
    console.error(`   - The service ID should be a UUID (e.g., 33ba0893-4dfe-49d1-9b62-ee86107bb6cb)`);
    process.exit(1);
}

runTest();

