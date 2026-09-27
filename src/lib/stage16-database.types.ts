import type { Database, Json } from "@/lib/database.types";

type Stage16Functions = {
  confirm_product_activation_v2: {
    Args: {
      p_workspace_id: string;
      p_canonical_url: string;
      p_domain: string;
      p_name: string;
      p_description: string;
      p_moments: Json;
    };
    Returns: {
      workspace_id: string;
      product_id: string;
      moment_count: number;
    }[];
  };
  set_workspace_capabilities_v2: {
    Args: {
      p_workspace_id: string;
      p_capabilities: string[];
    };
    Returns: {
      workspace_id: string;
      capability: string;
    }[];
  };
  create_offer_activation_v2: {
    Args: {
      p_workspace_id: string;
      p_title: string;
      p_description: string;
      p_cta_label: string;
      p_destination_url: string;
      p_moment_ids: string[];
    };
    Returns: {
      workspace_id: string;
      offer_id: string;
      moment_count: number;
    }[];
  };
};

export type Stage16Database = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Functions"> & {
    Functions: Database["public"]["Functions"] & Stage16Functions;
  };
};
