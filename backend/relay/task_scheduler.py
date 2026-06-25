import sys

from .services import task_scheduler as _module

sys.modules[__name__] = _module
