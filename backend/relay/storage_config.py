import sys

from .core import storage_config as _module

sys.modules[__name__] = _module
