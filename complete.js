exports.handler = async (event) => {
    // 🛡️ The net: We guarantee CORS is ALWAYS returned no matter what happens
    const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Credentials": true
    };

    try {
        // 🚨 Moving ALL imports INSIDE the try block. 
        // If AWS SDK is missing, it will be trapped here instead of crashing the server!
        const AWS = require("aws-sdk");
        const docClient = new AWS.DynamoDB.DocumentClient();
        const s3 = new AWS.S3();

        const TABLE_NAME = "SecretSharer-v2";
        const BUCKET_NAME = "secret-sharer-files-param-123";

        if (!event.body) {
            return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: "AWS provided an empty body" }) };
        }

        const body = JSON.parse(event.body);
        const fallbackId = Date.now().toString(36) + Math.random().toString(36).substring(2);
        const finalId = body.secretId || fallbackId;

        // Stitch S3 chunks safely
        if (body.hasFile && body.etags && body.uploadId) {
            const fixedParts = body.etags.map(part => ({
                PartNumber: part.PartNumber,
                ETag: part.ETag.includes('"') ? part.ETag : `"${part.ETag}"`
            }));

            await s3.completeMultipartUpload({
                Bucket: BUCKET_NAME,
                Key: `uploads/${finalId}`,
                MultipartUpload: { Parts: fixedParts },
                UploadId: body.uploadId
            }).promise();
        }

        // Prepare Database Row
        const item = {
            secretId: finalId,
            secretData: body.secretData || "EMPTY",
            hasFile: body.hasFile || false,
            viewsRemaining: body.maxViews ? parseInt(body.maxViews) : 1,
            wantsAlert: body.wantsAlert || false,
            createdAt: new Date().toISOString()
        };

        if (body.expireSeconds) {
            item.ttl = Math.floor(Date.now() / 1000) + parseInt(body.expireSeconds);
        }

        // Commit to DB
        await docClient.put({ TableName: TABLE_NAME, Item: item }).promise();

        return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ id: finalId }) };

    } catch (error) {
        // 🪤 THE TRAP SPRINGS: This catches the fatal crash and sends it to your browser!
        console.error("FATAL TRAPPED ERROR:", error);
        return { 
            statusCode: 500, 
            headers: corsHeaders, 
            body: JSON.stringify({ 
                error: "BACKEND CRASH TRAPPED", 
                message: error.message,
                stack: error.stack
            }) 
        };
    }
};