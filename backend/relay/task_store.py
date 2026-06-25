import sys

from .persistence import task_store as _module

sys.modules[__name__] = _module
