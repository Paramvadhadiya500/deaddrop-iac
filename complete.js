const AWS = require("aws-sdk");
const docClient = new AWS.DynamoDB.DocumentClient();
const s3 = new AWS.S3();

const TABLE_NAME = "SecretSharer-v2";
const BUCKET_NAME = "secret-sharer-files-param-123";

exports.handler = async (event) => {
    // 🛡️ Safe, stripped-down CORS headers
    const headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "OPTIONS,POST,GET",
        "Access-Control-Allow-Headers": "Content-Type"
    };

    try {
        const body = JSON.parse(event.body);

        // 1. Zero-dependency ID generation (No 'crypto' module needed!)
        const fallbackId = Date.now().toString(36) + Math.random().toString(36).substring(2);
        const finalId = body.secretId || fallbackId;

        // 2. Stitch S3 Chunks safely
        if (body.hasFile && body.etags && body.uploadId) {
            
            // 🛠️ FIX: S3 strictly requires double-quotes around ETags. We add them back here safely.
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

        // 3. Prepare DynamoDB record
        const item = {
            secretId: finalId,
            secretData: body.secretData || "EMPTY",
            hasFile: body.hasFile || false,
            viewsRemaining: body.maxViews ? parseInt(body.maxViews) : 1,
            wantsAlert: body.wantsAlert || false,
            createdAt: new Date().toISOString()
        };

        // 4. Attach TTL Safely
        if (body.expireSeconds) {
            item.ttl = Math.floor(Date.now() / 1000) + parseInt(body.expireSeconds);
        }

        // 5. Commit to Database
        await docClient.put({ TableName: TABLE_NAME, Item: item }).promise();

        return { 
            statusCode: 200, 
            headers: headers, 
            body: JSON.stringify({ id: finalId }) 
        };

    } catch (error) {
        console.error("LAMBDA ERROR:", error);
        // 🛡️ Even if it fails, we return a 400 with headers so the browser can actually read the error!
        return { 
            statusCode: 400, 
            headers: headers, 
            body: JSON.stringify({ error: error.message || "Unknown Error" }) 
        };
    }
};