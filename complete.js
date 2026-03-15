const AWS = require("aws-sdk");
const docClient = new AWS.DynamoDB.DocumentClient();
const s3 = new AWS.S3();

const TABLE_NAME = "SecretSharer-v2";
const BUCKET_NAME = "secret-sharer-files-param-123";

exports.handler = async (event) => {
    // 🛡️ Bulletproof CORS Headers (Removed Allow-Credentials to prevent wildcard conflicts)
    const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "OPTIONS,POST,GET",
        "Access-Control-Allow-Headers": "Content-Type"
    };

    try {
        console.log("Incoming Request Payload:", event.body);
        if (!event.body) throw new Error("Missing request body");

        const body = typeof event.body === "string" ? JSON.parse(event.body) : event.body;
        const { secretId, uploadId, etags, secretData, hasFile, maxViews, expireSeconds, wantsAlert } = body;

        // 1. Generate ID if Text-Only (Safe AWS UUID method)
        const finalId = secretId || AWS.util.uuid.v4();
        console.log("Assigned ID:", finalId);

        // 2. Stitch S3 Chunks
        if (hasFile && etags && uploadId) {
            console.log("Stitching S3 parts...");
            
            // 🛡️ Ensure ETags have strict double-quotes (AWS S3 randomly crashes without these)
            const formattedParts = etags.map(p => ({
                PartNumber: p.PartNumber,
                ETag: p.ETag.includes('"') ? p.ETag : `"${p.ETag}"`
            }));

            await s3.completeMultipartUpload({
                Bucket: BUCKET_NAME,
                Key: `uploads/${finalId}`,
                MultipartUpload: { Parts: formattedParts },
                UploadId: uploadId
            }).promise();
            console.log("S3 Stitching Complete.");
        }

        // 3. Prepare DynamoDB record safely
        console.log("Saving metadata to DynamoDB...");
        const item = {
            secretId: finalId,
            secretData: secretData || "",
            hasFile: hasFile || false,
            viewsRemaining: maxViews !== undefined ? parseInt(maxViews) : 1,
            wantsAlert: wantsAlert || false,
            createdAt: new Date().toISOString()
        };

        // 4. Attach TTL Safely
        if (expireSeconds) {
            const ttl = Math.floor(Date.now() / 1000) + parseInt(expireSeconds);
            if (!isNaN(ttl)) item.ttl = ttl;
        }

        // 5. Commit
        await docClient.put({ TableName: TABLE_NAME, Item: item }).promise();
        console.log("DynamoDB Save Complete.");

        return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ id: finalId }) };

    } catch (error) {
        console.error("CRITICAL LAMBDA ERROR:", error);
        return { 
            statusCode: 500, 
            headers: corsHeaders, 
            body: JSON.stringify({ error: error.message || "Internal server error" }) 
        };
    }
};