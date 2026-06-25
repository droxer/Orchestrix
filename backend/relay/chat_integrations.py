import sys

from .services import chat_integrations as _module

sys.modules[__name__] = _module
