 import os
from dataclasses import dataclass, field

from app.config.knowledge_base import ChunkStrategy, KnowledgeBase
from app.config.settings import (
    EMBEDDING_MODEL_LIST,
    LLM_LIST,
    MAX_RETRIES,
    MAX_TOKENS,
    RERANK_MODEL_LIST,
    RAG_FLOW_API_KEY,
    RAG_FLOW_API_BASE_URL,
    STORAGE,
    TEMPERATURE,
    TOKEN_BUDGET_FOR_GRAPH_COMPLETION,
    DEFAULT_PROMPT_FILE,
    GRAPH_COMPLETION_PROMPT_TEMPLATE,
    CHUNK_SIZE,
    CHUNK_OVERLAP,
    FROM_BROWSER,
    SVG_READER,
    API_KEY_FILE,
)
from app.exceptions import (
    NoKeyError,
    NoSharedRerankModelError,
    ParseEmbServerAddressError,
)


def resolve_env_var(value):
    """Resolve environment variable placeholders in config values.

    Supports formats:
      - ``${VAR_NAME}`` – value of env var ``VAR_NAME``
      - ``${VAR_NAME:default}`` – fallback to ``default`` if unset
    """
    if not isinstance(value, str):
        return value

    import re

    pattern = re.compile(r"\$\{(\w+)(?::([^}]*))?\}")

    def replacer(match):
        var_name = match.group(1)
        default_value = match.group(2)
        return os.environ.get(var_name, default_value if default_value is not None else "")

    return pattern.sub(replacer, value)


@dataclass
class APIKeys:
    """Stores API keys for various LLM providers."""

    # General
    MOONSHOT_API_KEY: str = field(default_factory=lambda: os.getenv("MOONSHOT_API_KEY", ""))
    TONGYI_API_KEY: str = field(default_factory=lambda: os.getenv("TONGYI_API_KEY", ""))
    WENXIN_API_KEY: str = field(default_factory=lambda: os.getenv("WENXIN_API_KEY", ""))
    SHENGLI_API_KEY: str = field(default_factory=lambda: os.getenv("SHENGLI_API_KEY", ""))
    ZHIPU_API_KEY: str = field(default_factory=lambda: os.getenv("ZHIPU_API_KEY", ""))

    # Embedding
    JINA_API_KEY: str = field(default_factory=lambda: os.getenv("JINA_API_KEY", ""))
    MISTRAL_API_KEY: str = field(default_factory=lambda: os.getenv("MISTRAL_API_KEY", ""))
    BAICHUAN_API_KEY: str = field(default_factory=lambda: os.getenv("BAICHUAN_API_KEY", ""))
    YI_API_KEY: str = field(default_factory=lambda: os.getenv("YI_API_KEY", ""))
    TIAMAT_API_KEY: str = field(default_factory=lambda: os.getenv("TIAMAT_API_KEY", ""))
    VOLCENGINE_API_KEY: str = field(default_factory=lambda: os.getenv("VOLCENGINE_API_KEY", ""))

    # GraphRAG
    NEBULA_API_KEY: str = field(default_factory=lambda: os.getenv("NEBULA_API_KEY", ""))

    def api_keys(self, provider: str | None = None) -> dict[str, str]:
        """Returns a dict of provider → API key, optionally for a single provider."""
        if provider:
            key = getattr(self, f"{provider.upper()}_API_KEY", "")
            if not key:
                raise NoKeyError(provider)
            return {provider: key}

        return {
            "MOONSHOT": self.MOONSHOT_API_KEY,
            "TONGYI": self.TONGYI_API_KEY,
            "WENXIN": self.WENXIN_API_KEY,
            "SHENGLI": self.SHENGLI_API_KEY,
            "ZHIPU": self.ZHIPU_API_KEY,
            "JINA": self.JINA_API_KEY,
            "MISTRAL": self.MISTRAL_API_KEY,
            "BAICHUAN": self.BAICHUAN_API_KEY,
            "YI": self.YI_API_KEY,
            "TIAMAT": self.TIAMAT_API_KEY,
            "NEBULA": self.NEBULA_API_KEY,
            "VOLCENGINE": self.VOLCENGINE_API_KEY,
        }


@dataclass
class LLM:
    """Manages LLM configurations and provides methods to access them."""

    conf: dict = field(default_factory=dict)

    def __post_init__(self):
        self.default_llm = os.getenv("LLM_LIST", LLM_LIST)
        self.conf = {
            "LLM_LIST": self.default_llm,
            "EMBEDDING_MODEL_LIST": EMBEDDING_MODEL_LIST,
            "RERANK_MODEL_LIST": RERANK_MODEL_LIST,
            "LLM_CHUNK_SIZE": CHUNK_SIZE,
            "LLM_CHUNK_OVERLAP": CHUNK_OVERLAP,
            "GRAPH_COMPLETION_TOKEN_BUDGET_FOR_GRAPH_COMPLETION": TOKEN_BUDGET_FOR_GRAPH_COMPLETION,
            "API_KEY_FILE": API_KEY_FILE,
            "GRAPH_COMPLETION_PROMPT_TEMPLATE": GRAPH_COMPLETION_PROMPT_TEMPLATE,
            "DEFAULT_PROMPT_FILE": DEFAULT_PROMPT_FILE,
            "SVG_READER": SVG_READER,
            "FROM_BROWSER": FROM_BROWSER,
            "MAX_RETRIES": MAX_RETRIES,
        }

    @staticmethod
    def api_key(provider: str | None = None):
        return APIKeys().api_keys(provider)

    def models(self, llm_type: str = "LLM") -> list[str]:
        """Return a list of model names for the given type (LLM or EMBEDDING)."""
        env_var = "LLM_LIST" if llm_type == "LLM" else "EMBEDDING_MODEL_LIST"
        model_list = os.getenv(env_var, "").split(",")
        return [model.strip() for model in model_list if model.strip()]

    def llm_name_to_id(self, name: str) -> str | None:
        for llm in self.default_llm.split(","):
            llm = llm.strip()
            if llm and llm.split("@")[0] == name:
                return llm
        return None

    def max_retries(self) -> int:
        """Returns the max_retries for LLM calls."""
        env_value = os.getenv("MAX_RETRIES")
        if env_value is not None:
            return int(env_value)
        return self.conf.get("MAX_RETRIES", 5)

    def max_tokens(self) -> int:
        """Returns the max tokens for LLM calls."""
        return int(os.getenv("MAX_TOKENS", MAX_TOKENS))

    def temperature(self) -> float:
        """Returns the temperature setting."""
        return float(os.getenv("TEMPERATURE", TEMPERATURE))

    def api_base(self) -> str:
        """Returns the API base URL setting."""
        return os.getenv("RAG_FLOW_API_BASE_URL", RAG_FLOW_API_BASE_URL)

    def api_key(self) -> str:
        """Returns the API key setting."""
        return os.getenv("RAG_FLOW_API_KEY", RAG_FLOW_API_KEY)

    def chunk_size(self) -> int:
        """Returns the chunk size setting."""
        return int(os.getenv("CHUNK_SIZE", CHUNK_SIZE))

    def chunk_overlap(self) -> int:
        """Returns the chunk overlap setting."""
        return int(os.getenv("CHUNK_OVERLAP", CHUNK_OVERLAP))

    def max_context_length(self) -> int:
        """Returns the maximum context length."""
        return int(os.getenv("MAX_TOKENS", MAX_TOKENS))

    @staticmethod
    def try_get_api_base_and_key_from_config(
        name: str, lang: str = "English"
    ) -> tuple[dict[str, str] | None, dict[str, str] | None]:
        try:
            llm_config = LLM(name)
            api_key = llm_config.api_key(name.split("@")[1])
            api_base = {name: LLM.parse_llm_api_url(llm_config.get_value(name, "api_base", lang))}
            return api_key, api_base
        except Exception:
            return None, None

    @staticmethod
    def default_model() -> str:
        """Returns the default model from the environment variable.

        Format: ``<provider/model_name>@<provider_name>``

        Examples:
          - ``openai/gpt-4o@openai`` – OpenAI GPT-4o
          - ``bedrock/anthropic.claude-3-5-sonnet@aws_bedrock`` – Claude 3.5 on Bedrock

        Environment variable: ``DEFAULT_MODEL`` (default: ``openai/gpt-4o-mini@openai``)
        """
        return os.getenv("DEFAULT_MODEL", "openai/gpt-4o-mini@openai")

    @staticmethod
    def default_retries() -> int:
        """Returns the default max retries for LLM calls.

        This value is used as the default when no provider-specific
        ``max_retries`` is configured in the model configuration dict.

        Environment variable: ``DEFAULT_RETRIES`` (default: ``5``)

        Example:
          - ``DEFAULT_RETRIES=3`` – use 3 retries globally
        """
        return int(os.getenv("DEFAULT_RETRIES", "5"))

    def get_value(self, name: str, key: str, lang: str = "English") -> str:
        if key == "provider":
            return name.split("@")[-1]
        if key == "model_name":
            return name.split("@")[0].split("/")[-1]
        if key == "llm_name":
            return name.split("@")[0]
        if key == "api_base":
            return self.parse_llm_api_url(self.get_conf_from_token_pool(name, "api_base", lang))
        try:
            model_configurations = self.get_conf_from_token_pool(name, "model_configurations", lang)
            if key in model_configurations:
                value = model_configurations[key]
                if isinstance(value, str) and "${" in value and "}" in value:
                    return resolve_env_var(value)
                return value
        except Exception:
            pass
        if key == "api_key":
            return APIKeys().api_keys(name.split("@")[-1]).get(name.split("@")[-1], "")
        return ""

    def get_conf_from_token_pool(self, name: str, key: str, lang: str = "English"):
        if "@" not in name:
            raise ValueError(f"Invalid LLM name format: {name}. Expected format: 'model_name@provider_name'.")

        file_path = str(APIKeys.api_keys(name.split("@")[-1]).get("API_KEY_FILE", API_KEY_FILE))
        if not os.path.exists(file_path):
            file_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "api_key_file_copy.py")

        if not os.path.exists(file_path):
            raise FileNotFoundError(f"API key file not found: {file_path}")

        import importlib.util

        spec = importlib.util.spec_from_file_location("api_key_pool", file_path)
        api_key_pool = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(api_key_pool)

        try:
            model_configurations = getattr(api_key_pool, "MODEL_CONFIGURATIONS", None)
            if model_configurations and name in model_configurations:
                value = model_configurations[name].get(key, "")
                if key == "model_configurations":
                    return model_configurations[name]
                if isinstance(value, str) and "${" in value and "}" in value:
                    return resolve_env_var(value)
                return value
        except Exception as e:
            raise ValueError(f"Error loading API key from file: {e}")

        if key == "api_key":
            model_to_api_key = getattr(api_key_pool, "MODEL_TO_API_KEY", None)
            if model_to_api_key and name in model_to_api_key:
                return model_to_api_key[name]

        if key == "api_base":
            model_to_api_base = getattr(api_key_pool, "MODEL_TO_API_BASE", None)
            if model_to_api_base and name in model_to_api_base:
                return model_to_api_base[name]

        if key in ["api_key", "api_base"]:
            return self.get_conf(name, key, lang)

        raise ValueError(f"API key not found for {name} in the token pool file ({file_path}).")

    def get_conf(self, name: str, key: str, lang: str = "English"):
        if "@" not in name:
            raise ValueError(f"Invalid LLM name format: {name}. Expected format: 'model_name@provider_name'.")

        try:
            file_path = str(APIKeys().api_keys(name.split("@")[-1]).get("API_KEY_FILE", API_KEY_FILE))
            if not os.path.exists(file_path):
                file_path = os.path.join(
                    os.path.dirname(os.path.dirname(__file__)),
                    "..",
                    "examples",
                    "gradio",
                    "api_key_file.py",
                )

            import importlib.util

            spec = importlib.util.spec_from_file_location("api_key_pool", file_path)
            api_key_pool = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(api_key_pool)

            model_to_api_key = getattr(api_key_pool, "MODEL_TO_API_KEY", None)
            if model_to_api_key and name in model_to_api_key:
                return model_to_api_key[name]

            model_to_api_base = getattr(api_key_pool, "MODEL_TO_API_BASE", None)
            if model_to_api_base and name in model_to_api_base:
                return model_to_api_base[name]
        except Exception:
            pass

        try:
            llms = LLM()
            if key == "api_base":
                return os.getenv(f"{name}_API_BASE", os.getenv("LOCAL_LLM_BASE_URL", ""))
            elif key == "api_key":
                api_keys_dict = llms.api_key()
                return api_keys_dict.get(name.split("@")[-1], "")
            return ""
        except Exception:
            return ""

    def get_model_by_type(self, model_type: str = "LLM") -> list:
        """Retrieve a list of models based on the specified type.

        Args:
            model_type: The type of model to retrieve (e.g., "LLM", "EMBEDDING").

        Returns:
            A list of models matching the specified type.
        """
        import json

        if model_type == "LLM":
            return [m for m in self.default_llm.split(",") if m.strip()]
        elif model_type == "EMBEDDING":
            embedding_models_str = os.getenv("EMBEDDING_MODEL_LIST", EMBEDDING_MODEL_LIST)
            return [m.strip() for m in embedding_models_str.split(",") if m.strip()]
        elif model_type == "RERANK":
            rerank_models_str = os.getenv("RERANK_MODEL_LIST", RERANK_MODEL_LIST)
            return json.loads(rerank_models_str) if rerank_models_str else []
        elif model_type == "SPEECH2TEXT":
            return ["FunASR"]
        elif model_type == "TTS":
            return ["Bark", "TTS", "FISH_AUDIO", "ChatTTS"]
        else:
            raise ValueError(f"Unsupported model type: {model_type}")

    @staticmethod
    def parse_llm_api_url(url: str) -> str:
        if url and "/" in url:
            if url.split("/")[-1] not in ["v1", "v2", "v3"]:
                if url.split("/")[-1] == "openai":
                    url = url + "/v1"
                else:
                    url = url.rstrip("/") + "/v1"
        return url


@dataclass
class KnowledgeBase:
    """Manages knowledge base configurations."""

    chunks: list = field(default_factory=list)
    chunk_num: int = 0
    kb_name: str = ""
    kb_id: str = ""
    kb_folder_id: str = ""
    embd_model: str = ""
    embd_dimensions: int = 1024
    img_dimension: int = 512
    similarity_threshold: float = 0.1
    vector_similarity_weight: float = 0.3
    top_n: int = 5
    top_k: int = 1024
    chunk_method: str = "ChunkMethod.NAIVE"
    parser_config: dict = field(default_factory=dict)
    status: str = "1"
    embd_batch_size: int = 150
    parser_ids: list = field(default_factory=list)

    @staticmethod
    def chunk_method_enum():
        return list(ChunkStrategy)

    def to_dict(self):
        return {
            "chunks": self.chunks,
            "chunk_num": self.chunk_num,
            "kb_name": self.kb_name,
            "kb_id": self.kb_id,
            "kb_folder_id": self.kb_folder_id,
            "embd_model": self.embd_model,
            "embd_dimensions": self.embd_dimensions,
            "img_dimension": self.img_dimension,
            "similarity_threshold": self.similarity_threshold,
            "vector_similarity_weight": self.vector_similarity_weight,
            "top_n": self.top_n,
            "top_k": self.top_k,
            "chunk_method": self.chunk_method,
            "parser_config": self.parser_config,
            "status": self.status,
            "embd_batch_size": self.embd_batch_size,
            "parser_ids": self.parser_ids,
        }


MAX_RETRIES = int(os.getenv("MAX_RETRIES", "5"))