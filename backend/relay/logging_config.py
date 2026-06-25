import sys

from .core import logging_config as _module

sys.modules[__name__] = _module
