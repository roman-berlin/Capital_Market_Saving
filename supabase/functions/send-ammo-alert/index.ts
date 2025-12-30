import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface AmmoAlertRequest {
  recommendation_type: string;
  recommendation_text: string;
  drawdown_percent: number;
  transfer_amount: number | null;
  market_status: string;
}

// HTML entity encoding to prevent XSS
function escapeHtml(text: string): string {
  const htmlEntities: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#x27;',
    '/': '&#x2F;'
  };
  return text.replace(/[&<>"'\/]/g, char => htmlEntities[char]);
}

const handler = async (req: Request): Promise<Response> => {
  console.log("send-ammo-alert function called, method:", req.method);
  
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Authentication: Get user from JWT token
    const authHeader = req.headers.get("Authorization");
    console.log("Auth header present:", !!authHeader);
    
    if (!authHeader) {
      console.log("No auth header - returning 401");
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    console.log("Auth result - user:", user?.id, "error:", authError?.message);
    
    if (authError || !user) {
      console.log("Auth failed - returning 401");
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Use the authenticated user's email - don't accept email from request body
    const email = user.email;
    if (!email) {
      return new Response(JSON.stringify({ error: "User has no email" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { 
      recommendation_type, 
      recommendation_text, 
      drawdown_percent, 
      transfer_amount,
      market_status 
    }: AmmoAlertRequest = await req.json();

    // Input validation
    if (!recommendation_type || typeof recommendation_type !== 'string' || recommendation_type.length > 50) {
      return new Response(JSON.stringify({ error: "Invalid recommendation_type" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!recommendation_text || typeof recommendation_text !== 'string' || recommendation_text.length > 1000) {
      return new Response(JSON.stringify({ error: "Invalid recommendation_text" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!market_status || typeof market_status !== 'string' || market_status.length > 20) {
      return new Response(JSON.stringify({ error: "Invalid market_status" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (typeof drawdown_percent !== 'number' || isNaN(drawdown_percent)) {
      return new Response(JSON.stringify({ error: "Invalid drawdown_percent" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("Sending ammo alert to:", email, "Type:", recommendation_type, "User:", user.id);

    // Sanitize all user-controlled content for HTML
    const safeRecommendationType = escapeHtml(recommendation_type.replace(/_/g, " "));
    const safeRecommendationText = escapeHtml(recommendation_text);
    const safeMarketStatus = escapeHtml(market_status);

    const statusColors: Record<string, string> = {
      normal: "#22c55e",
      correction: "#eab308",
      bear: "#f97316",
      crash: "#ef4444",
    };

    const statusColor = statusColors[market_status] || "#6b7280";
    const amountText = transfer_amount ? `$${transfer_amount.toLocaleString()}` : "N/A";

    const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #0f172a; color: #e2e8f0; padding: 40px 20px;">
  <div style="max-width: 600px; margin: 0 auto; background-color: #1e293b; border-radius: 12px; padding: 32px; border: 1px solid #334155;">
    <h1 style="color: #f8fafc; margin-top: 0; font-size: 24px;">Portfolio Ammo Alert</h1>
    
    <div style="background-color: ${statusColor}20; border-left: 4px solid ${statusColor}; padding: 16px; border-radius: 0 8px 8px 0; margin: 24px 0;">
      <p style="margin: 0; font-size: 18px; font-weight: 600; color: ${statusColor};">
        ${safeRecommendationType}
      </p>
      <p style="margin: 8px 0 0; color: #cbd5e1;">
        Market Status: <strong style="color: ${statusColor};">${safeMarketStatus.toUpperCase()}</strong>
      </p>
    </div>

    <div style="background-color: #0f172a; border-radius: 8px; padding: 20px; margin: 24px 0;">
      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="padding: 8px 0; color: #94a3b8;">Drawdown</td>
          <td style="padding: 8px 0; text-align: right; color: #ef4444; font-weight: 600;">-${drawdown_percent.toFixed(1)}%</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #94a3b8;">Transfer Amount</td>
          <td style="padding: 8px 0; text-align: right; color: #22c55e; font-weight: 600;">${amountText}</td>
        </tr>
      </table>
    </div>

    <p style="color: #e2e8f0; line-height: 1.6; margin: 24px 0;">
      ${safeRecommendationText}
    </p>

    <hr style="border: none; border-top: 1px solid #334155; margin: 24px 0;">

    <p style="color: #64748b; font-size: 12px; margin-bottom: 0;">
      This alert was generated by Portfolio Ammo Tracker. Log in to your dashboard to take action.
    </p>
  </div>
</body>
</html>`;

    const emailResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: "Portfolio Ammo <alerts@automaxity.info>",
        to: [email],
        subject: `AMMO ALERT: ${safeRecommendationType}`,
        html: htmlContent,
      }),
    });

    const data = await emailResponse.json();

    if (!emailResponse.ok) {
      throw new Error(data.message || "Failed to send email");
    }

    console.log("Email sent successfully:", data);

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error: unknown) {
    console.error("Error in send-ammo-alert function:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);
